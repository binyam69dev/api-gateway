require('dotenv').config();
console.log('PORT from .env:', process.env.PORT);
console.log('All env vars with PORT:', Object.keys(process.env).filter(k => k.includes('PORT')));
