const express = require('express');
const app = express();

// Define the '/' route
app.get('/', (req, res) => {
    res.send('Hello, World!');
});

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
