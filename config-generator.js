const CryptoJS = require('crypto-js');
const readline = require('readline');

const ENCRYPTION_KEY = 'mttrackingapp-v1';

function encryptConfig(config) {
  const jsonStr = JSON.stringify(config);
  return CryptoJS.AES.encrypt(jsonStr, ENCRYPTION_KEY).toString();
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n===========================================');
  console.log('  Motor Town Map Tracker - Config Generator');
  console.log('===========================================\n');
  
  const apiBase = await askQuestion('Enter API Base URL (e.g., http://192.168.1.100:21120): ');
  const chatHistoryUrl = await askQuestion('Enter Chat History URL (optional, press Enter to skip): ');
  const apiPassword = await askQuestion('Enter API Password: ');
  
  if (!apiBase || !apiPassword) {
    console.log('\nError: API Base URL and Password are required!');
    rl.close();
    return;
  }
  
  const config = {
    api_base: apiBase.trim(),
    chat_history_url: chatHistoryUrl.trim() || 'http://localhost:3456/chat',
    api_password: apiPassword
  };
  
  const encrypted = encryptConfig(config);
  
  console.log('\n===========================================');
  console.log('  ENCRYPTED CONFIG (Share this with users)');
  console.log('===========================================\n');
  console.log(encrypted);
  console.log('\n===========================================');
  console.log('  HOW TO USE:');
  console.log('  1. Copy the encrypted string above');
  console.log('  2. Open the Motor Town Map Tracker app');
  console.log('  3. Click the ⚙️ settings button');
  console.log('  4. Go to "Encrypted Config" tab');
  console.log('  5. Paste the code and click "Apply Encrypted Config"');
  console.log('===========================================\n');
  
  rl.close();
}

main().catch(err => {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.error('Error: crypto-js is not installed.');
    console.error('Please install it first with: npm install crypto-js');
  } else {
    console.error('Error:', err.message);
  }
  rl.close();
});
