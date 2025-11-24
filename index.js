
// import express from "express";
// import ZKLib from "node-zklib";

// const app = express();
// const PORT = 5000;

// // Device function
// const fetchDeviceData = async () => {
//     const zkInstance = new ZKLib('192.168.18.253', 4370, 10000, 4000);

//     try {
//         await zkInstance.createSocket();
//         const info = await zkInstance.getInfo();
//         console.log("Device Info:", info);


//         const users = await zkInstance.getUsers();
//         console.log("Users:", users);

//         const logs = await zkInstance.getAttendances();
//         console.log("Attendance Logs:", logs);

//         // Optional: clear attendance logs if needed
//         // await zkInstance.clearAttendanceLog();

//         // await zkInstance.disconnect();
//         // console.log("Device disconnected successfully");

//         // return { info, users, logs };
//     } catch (err) {
//         console.error("Error fetching data:", err);
//         return { error: err.message };
//     }
// };

// // Route
// app.get("/", async (req, res) => {
//     const data = await fetchDeviceData();

//     res.json(data); // Send JSON response
// });

// app.listen(PORT, () => {
//     console.log(`Server running at http://localhost:${PORT}`);
// });

























import express from "express";
import ZKLib from "node-zklib";

const app = express();
const PORT = 5000;

app.set("view engine", "ejs");

const fetchDeviceData = async () => {
    const zkInstance = new ZKLib('192.168.18.252', 4370, 10000, 4000);

    try {
        await zkInstance.createSocket();

        const info = await zkInstance.getInfo();
        const users = await zkInstance.getUsers();
          const logs = await zkInstance.getAttendances();

          console.log(logs.data,"attendance")

          const attendanceLogs=logs.data

        const allUsers = users?.data || [];

        const adminUsers = allUsers.filter(u => u.role === 14);

        return { info, allUsers, adminUsers , attendanceLogs};

    } catch (err) {
        console.log("Error:", err);
        return { error: err.message };
    }
};

app.get("/", async (req, res) => {
    const data = await fetchDeviceData();
    res.render("index", data);
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
