require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'API Gateway is running',
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.json({ message: 'API Gateway - Coming Soon' });
});

app.listen(PORT, () => {
    console.log(`🚀 Gateway running on http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
});