const path = require('path');
require('dotenv').config();
console.log('Current directory:', process.cwd());
console.log('PORT from process.env:', process.env.PORT);

// Try to find all .env files
const fs = require('fs');
function findEnvFiles(dir) {
    try {
        const files = fs.readdirSync(dir);
        const envFiles = files.filter(f => f.startsWith('.env'));
        if (envFiles.length) {
            console.log('Found in', dir, ':', envFiles);
        }
    } catch(e) {}
}
findEnvFiles(process.cwd());
findEnvFiles(path.dirname(process.cwd()));
