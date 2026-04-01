const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3000/ws');

ws.on('open', () => {
  console.log('Connected');
  ws.send(JSON.stringify({
    type: 'invoke',
    id: 1,
    channel: 'ai-chat',
    args: [
      'Read the file src/app.js and list the files in the src directory. Also check if a file called README.md exists.',
      {
        projectPath: 'C:\\Users\\brend\\guide-2.0\\test-project\\stress-test-01',
        conversationHistory: [],
        params: { temperature: 0.7, maxTokens: 2048, topP: 0.9 }
      }
    ]
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === 'event') {
    if (msg.event === 'llm-token') {
      process.stdout.write(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data));
    } else if (msg.event === 'llm-tool-generating') {
      console.log('\n[TOOL-GEN]', JSON.stringify(msg.data || {}));
    } else if (msg.event === 'tool-executing') {
      console.log('\n[TOOL-EXEC]', JSON.stringify(msg.data || {}).substring(0, 300));
    } else if (msg.event === 'tool-results') {
      console.log('\n[TOOL-RESULT]', JSON.stringify(msg.data || {}).substring(0, 300));
    } else {
      console.log('\n[EVENT]', msg.event, JSON.stringify(msg.data || {}).substring(0, 200));
    }
  } else if (msg.type === 'response') {
    console.log('\n[RESPONSE]', msg.error ? 'ERROR: ' + msg.error : 'SUCCESS');
    if (msg.result) console.log('Result:', JSON.stringify(msg.result).substring(0, 500));
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => console.error('WS error:', e.message));
setTimeout(() => { console.log('\n[TIMEOUT] 90s'); ws.close(); process.exit(1); }, 90000);
