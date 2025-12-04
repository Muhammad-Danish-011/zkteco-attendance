import express from "express";
import ZKLib from "node-zklib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from 'node-cron';
import axios from 'axios';
import https from 'https';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

app.set("view engine", "ejs");
app.use(express.static("public"));

// Global State
let allAttendanceRecords = [];
let uniqueSignatures = new Set(); 
let latestDeviceData = {
    '192.168.18.253': { 
        info: {},
        allUsers: [],
        adminUsers: [],
        attendanceLogs: [],
        deviceIP: '192.168.18.253',
        status: 'initializing' 
    },
    '192.168.18.252': { 
        info: {},
        allUsers: [],
        adminUsers: [],
        attendanceLogs: [],
        deviceIP: '192.168.18.252',
        status: 'initializing' 
    }
};

// SSL bypass agent
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Helper to create a Unique Key for every record
const createRecordSignature = (record) => {
    return `${record.deviceIP}_${record.deviceUserId}_${new Date(record.recordTime).getTime()}`;
};

// Load existing records
const loadExistingRecords = () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const filepath = path.join(dataDir, `attendance_${today}.json`);
        
        allAttendanceRecords = [];
        uniqueSignatures.clear();

        if (fs.existsSync(filepath)) {
            const fileContent = fs.readFileSync(filepath, 'utf8');
            const data = JSON.parse(fileContent);
            
            if (Array.isArray(data)) {
                data.forEach(item => {
                    if (item.deviceUserId && item.recordTime) {
                        const sig = createRecordSignature(item);
                        if (!uniqueSignatures.has(sig)) {
                            uniqueSignatures.add(sig);
                            allAttendanceRecords.push(item);
                        }
                    }
                });
            }
            console.log(`📁 Loaded ${allAttendanceRecords.length} records from today's file`);
        }
    } catch (error) {
        console.log('❌ Error loading records:', error.message);
        allAttendanceRecords = [];
        uniqueSignatures.clear();
    }
};

// Save Records locally
const saveRecords = () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const filepath = path.join(dataDir, `attendance_${today}.json`);
        fs.writeFileSync(filepath, JSON.stringify(allAttendanceRecords, null, 2));
        console.log(`💾 Saved ${allAttendanceRecords.length} records locally to ${filepath}`);
        return filepath;
    } catch (error) {
        console.error('❌ Error saving records locally:', error);
        return null;
    }
};

// ==================== FETCH DEVICE DATA (YOUR WORKING LOGIC) ====================
const fetchDeviceData = async (ip) => {
    const zkInstance = new ZKLib(ip, 4370, 5000, 4000);

    try {
        await zkInstance.createSocket();
        
        // Get ALL data from device
        const info = await zkInstance.getInfo();
        const users = await zkInstance.getUsers();
        const logs = await zkInstance.getAttendances();

        const allUsers = users?.data || [];
        const adminUsers = allUsers.filter(u => u.role === 14);
        const attendanceLogs = logs?.data || [];

        // Create user map for name lookup
        const userMap = {};
        allUsers.forEach(user => {
            userMap[user.userId] = user.name;
        });

        // Enhance logs with user names
        const enhancedLogs = attendanceLogs.map(log => ({
            ...log,
            name: userMap[log.deviceUserId] || 'Unknown',
            type: ip === '192.168.18.253' ? 'IN' : 'OUT',
            deviceIP: ip,
            recordTime: new Date(log.recordTime).toISOString()
        }));

        await zkInstance.disconnect();
        
        console.log(`✅ ${ip}: Fetched ${enhancedLogs.length} logs`);
        
        return {
            info: info || {},
            allUsers,
            adminUsers,
            attendanceLogs: enhancedLogs,
            deviceIP: ip,
            status: 'online'
        };

    } catch (err) {
        console.log(`❌ Error from ${ip}:`, err.message);
        return {
            info: {},
            allUsers: [],
            adminUsers: [],
            attendanceLogs: [],
            deviceIP: ip,
            status: 'offline',
            error: err.message
        };
    }
};

// ==================== CLEAN DATA - REMOVE DUPLICATE FIELDS ====================
const cleanRecord = (record) => {
    // Remove duplicate 'ip' field, keep only 'deviceIP'
    const cleaned = {
        userSn: record.userSn || 0,
        deviceUserId: (record.deviceUserId || '').toString(),
        name: record.name || 'Unknown',
        recordTime: new Date(record.recordTime).toISOString(),
        deviceIP: record.deviceIP || record.ip || '', // Use deviceIP, fallback to ip
        type: record.type || 'UNKNOWN'
    };
    
    // Remove any undefined fields
    Object.keys(cleaned).forEach(key => {
        if (cleaned[key] === undefined || cleaned[key] === null) {
            delete cleaned[key];
        }
    });
    
    return cleaned;
};

// ==================== SEND TO C# API (PROPER FILE UPLOAD) ====================
const sendToCSharpAPI = async () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const attendanceFilePath = path.join(dataDir, `attendance_${today}.json`);
        
        if (!fs.existsSync(attendanceFilePath)) {
            console.log('⚠️ No attendance file found for today');
            return { success: false, message: 'No file found', recordsSent: 0 };
        }
        
        // Read and clean the data
        const fileContent = fs.readFileSync(attendanceFilePath, 'utf8');
        const allRecords = JSON.parse(fileContent);
        
        if (!Array.isArray(allRecords) || allRecords.length === 0) {
            console.log('⚠️ No records in file');
            return { success: false, message: 'No records', recordsSent: 0 };
        }
        
        console.log(`\n📤 Preparing to send ${allRecords.length} records...`);
        
        // Clean all records (remove duplicate ip/deviceIP)
        const cleanedRecords = allRecords.map(cleanRecord);
        
        // Check data quality
        const recordsWithName = cleanedRecords.filter(r => r.name && r.name !== 'Unknown').length;
        const recordsWithType = cleanedRecords.filter(r => r.type && r.type !== 'UNKNOWN').length;
        
        console.log(`📊 Data Quality: ${recordsWithName}/${cleanedRecords.length} with names, ${recordsWithType}/${cleanedRecords.length} with type`);
        
        // Show sample of cleaned data
        if (cleanedRecords.length > 0) {
            console.log('\n✅ Sample cleaned record:');
            console.log(JSON.stringify(cleanedRecords[0], null, 2));
        }
        
        // Create temp file with cleaned data
        const tempFilePath = path.join(dataDir, `upload_${Date.now()}.json`);
        fs.writeFileSync(tempFilePath, JSON.stringify(cleanedRecords, null, 2));
        
        console.log(`\n🔄 Uploading to C# API...`);
        console.log(`📎 File: ${tempFilePath} (${cleanedRecords.length} records)`);
        
        const startTime = Date.now();
        
        // Upload file using FormData
        const formDataModule = await import('form-data');
        const FormData = formDataModule.default || formDataModule;
        const formData = new FormData();
        
        formData.append('file', fs.createReadStream(tempFilePath), {
            filename: `attendance_${today}.json`,
            contentType: 'application/json'
        });
        
        const response = await axios.post(
            'https://api20230805195433.azurewebsites.net/api/attendance/upload-file',
            formData,
            {
                headers: formData.getHeaders(),
                httpsAgent: httpsAgent,
                timeout: 60000
            }
        );
        
        const duration = Math.round((Date.now() - startTime) / 1000);
        
        // Cleanup temp file
        fs.unlinkSync(tempFilePath);
        
        console.log(`\n✅ Upload successful in ${duration} seconds!`);
        console.log(`📊 Status: ${response.status}`);
        console.log(`📦 API Response:`, response.data);
        
        return {
            success: true,
            status: response.status,
            data: response.data,
            recordsSent: cleanedRecords.length,
            duration: duration,
            message: `Uploaded ${cleanedRecords.length} records in ${duration}s`
        };
        
    } catch (error) {
        console.error('\n❌ UPLOAD ERROR:', error.message);
        
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', error.response.data);
        }
        
        return {
            success: false,
            error: error.message,
            recordsSent: 0,
            statusCode: error.response?.status
        };
    }
};

// ==================== MAIN SYNC LOGIC (EVERY 3 MINUTES) ====================
const fetchAndSendToAPI = async () => {
    const devices = ['192.168.18.253', '192.168.18.252'];
    console.log('\n' + '='.repeat(50));
    console.log('🚀 SYNC PROCESS STARTED');
    console.log('='.repeat(50));

    try {
        const results = await Promise.allSettled(devices.map(ip => fetchDeviceData(ip)));
        
        let newRecordsCount = 0;
        const currentBatchData = {};

        results.forEach((result, index) => {
            const ip = devices[index];
            
            if (result.status === 'fulfilled') {
                const deviceData = result.value;
                currentBatchData[ip] = deviceData;
                
                // Check for new attendance records
                deviceData.attendanceLogs.forEach(record => {
                    const sig = createRecordSignature(record);
                    if (!uniqueSignatures.has(sig)) {
                        uniqueSignatures.add(sig);
                        allAttendanceRecords.push(record);
                        newRecordsCount++;
                    }
                });

            } else {
                currentBatchData[ip] = {
                    info: {},
                    allUsers: [],
                    adminUsers: [],
                    attendanceLogs: [],
                    deviceIP: ip,
                    status: 'offline',
                    error: result.reason.message
                };
            }
        });

        // Update global state
        latestDeviceData = currentBatchData;

        if (newRecordsCount > 0) {
            // Save locally first (with cleaned data)
            const savedPath = saveRecords();
            console.log(`\n💾 Saved ${allAttendanceRecords.length} records to: ${savedPath}`);
            
            // Send ALL records to C# API (not just new ones)
            console.log(`\n📨 Sending to C# API...`);
            const apiResult = await sendToCSharpAPI();
            
            console.log(`\n✅ Added & Saved ${newRecordsCount} NEW attendance records locally.`);
            console.log(`📤 API Send Result: ${apiResult.success ? 'Success' : 'Failed'}`);
            
            if (apiResult.success) {
                console.log(`✅ Sent ${apiResult.recordsSent} records to C# API successfully`);
            } else {
                console.log(`❌ Failed to send to C# API: ${apiResult.error}`);
            }
            
            return {
                success: apiResult.success,
                totalRecords: allAttendanceRecords.length,
                newRecordsCount,
                apiSent: apiResult.success,
                recordsSent: apiResult.recordsSent,
                message: apiResult.success ? 
                    `Successfully sent ${apiResult.recordsSent} records` : 
                    `Failed: ${apiResult.error}`
            };
        } else {
            console.log(`\n⏭️ No new records found. Nothing to send to API.`);
            return {
                success: true,
                totalRecords: allAttendanceRecords.length,
                newRecordsCount: 0,
                apiSent: false,
                recordsSent: 0,
                message: 'No new records'
            };
        }

    } catch (err) {
        console.log("❌ Error:", err.message);
        return { 
            success: false,
            error: err.message,
            message: 'Process failed' 
        };
    }
};

// ==================== CRON JOB - EVERY 3 MINUTES ====================
console.log(`\n⏰ Setting up auto-sync every 3 minutes...`);

const attendanceCron = cron.schedule('*/3 * * * *', async () => {
    console.log('\n' + '='.repeat(50));
    console.log('🔔 AUTO SYNC STARTED');
    console.log('='.repeat(50));
    
    const startTime = Date.now();
    const result = await fetchAndSendToAPI();
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log(`\n⏱️  Total Duration: ${duration} seconds`);
    console.log(`💾 Database Update: ${result.apiSent ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    const nextRun = new Date();
    nextRun.setMinutes(nextRun.getMinutes() + 3);
    console.log(`⏳ Next Sync: ${nextRun.toLocaleTimeString()}`);
    console.log('='.repeat(50) + '\n');
    
}, {
    scheduled: true,
    timezone: "Asia/Karachi"
});

attendanceCron.start();

// ==================== API ENDPOINTS ====================
app.get("/", async (req, res) => {
    try {
        const data = await fetchAndSendToAPI();
        res.render("index", {
            deviceData: latestDeviceData,
            totalRecords: allAttendanceRecords.length,
            allAttendanceRecords: allAttendanceRecords.slice(-10),
            lastSync: new Date().toLocaleString(),
            nextSync: new Date(Date.now() + 3 * 60 * 1000).toLocaleString()
        });
    } catch (error) {
        res.render("index", {
            deviceData: latestDeviceData,
            totalRecords: allAttendanceRecords.length,
            allAttendanceRecords: allAttendanceRecords.slice(-10),
            lastSync: 'Never',
            nextSync: new Date(Date.now() + 3 * 60 * 1000).toLocaleString()
        });
    }
});

app.get("/api/data", async (req, res) => {
    try {
        const data = await fetchAndSendToAPI();
        res.json({
            success: true,
            deviceData: latestDeviceData,
            totalRecords: allAttendanceRecords.length,
            allAttendanceRecords: allAttendanceRecords.slice(-50),
            lastSyncTime: new Date().toISOString(),
            nextSyncTime: new Date(Date.now() + 3 * 60 * 1000).toISOString()
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message,
            deviceData: latestDeviceData,
            totalRecords: allAttendanceRecords.length,
            allAttendanceRecords: allAttendanceRecords.slice(-50)
        });
    }
});

// Manual trigger endpoint
app.get("/api/trigger", async (req, res) => {
    console.log('🔔 Manual trigger requested');
    const result = await fetchAndSendToAPI();
    
    res.json({
        success: result.success || false,
        message: result.message || 'Process completed',
        records: result.totalRecords || 0,
        newRecords: result.newRecordsCount || 0,
        apiSent: result.apiSent || false,
        recordsSent: result.recordsSent || 0
    });
});

// Health check
app.get("/api/health", (req, res) => {
    const nextRun = new Date(Date.now() + 3 * 60 * 1000);
    
    res.json({ 
        status: 'RUNNING',
        timestamp: new Date().toISOString(),
        cronJob: {
            interval: 'Every 3 minutes',
            active: true,
            nextRun: nextRun.toISOString()
        },
        data: {
            totalRecords: allAttendanceRecords.length,
            uniqueSignatures: uniqueSignatures.size
        },
        devices: {
            '192.168.18.253': latestDeviceData['192.168.18.253']?.status || 'unknown',
            '192.168.18.252': latestDeviceData['192.168.18.252']?.status || 'unknown'
        },
        api: {
            endpoint: 'https://api20230805195433.azurewebsites.net/api/attendance/upload-file',
            method: 'File Upload (multipart/form-data)'
        }
    });
});

// Debug endpoint - show cleaned data
app.get("/api/debug", (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const filepath = path.join(dataDir, `attendance_${today}.json`);
    
    let records = [];
    if (fs.existsSync(filepath)) {
        try {
            const rawData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
            records = rawData.map(cleanRecord);
        } catch (e) {}
    }
    
    const withNames = records.filter(r => r.name && r.name !== 'Unknown').length;
    const withoutNames = records.length - withNames;
    
    res.json({
        success: true,
        totalRecords: records.length,
        withNames: withNames,
        withoutNames: withoutNames,
        namePercentage: records.length > 0 ? Math.round((withNames/records.length)*100) : 0,
        sampleRecords: records.slice(0, 5)
    });
});

// ==================== STARTUP ====================
console.log('\n' + '='.repeat(60));
console.log('🚀 ZKTECO ATTENDANCE SYNC SERVICE');
console.log('='.repeat(60));
console.log('📡 Port:', PORT);
console.log('⏰ Schedule: Every 3 minutes');
console.log('🌐 C# API: https://api20230805195433.azurewebsites.net');
console.log('💾 Data Directory:', dataDir);
console.log('='.repeat(60) + '\n');

// Load existing data
loadExistingRecords();

// Initial sync after startup
setTimeout(async () => {
    console.log('🔔 Performing initial sync...\n');
    await fetchAndSendToAPI();
    console.log(`\n✅ Service is running!`);
    console.log(`🏠 Dashboard: http://localhost:${PORT}`);
    console.log(`📊 Data API: http://localhost:${PORT}/api/data`);
    console.log(`📤 Manual Trigger: http://localhost:${PORT}/api/trigger`);
    console.log(`🔄 Next auto-sync in 3 minutes...\n`);
}, 2000);

// Start server
app.listen(PORT, () => {
    console.log(`✅ Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    attendanceCron.stop();
    process.exit(0);
});