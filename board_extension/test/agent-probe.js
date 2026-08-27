// Proves the SDK can run from a CommonJS host with the local Claude login,
// and that messages stream back. Deliberately trivial so it costs nothing.
const path = require('path');

// TypeScript rewrites `import()` to `require()` under CommonJS, which cannot
// load an ESM-only package. Hiding it in a Function keeps it a real import.
const esmImport = new Function('spec', 'return import(spec)');

(async () => {
  const started = Date.now();
  const sdk = await esmImport('@anthropic-ai/claude-agent-sdk');
  console.log('SDK loaded from CJS:', typeof sdk.query === 'function' ? 'ok' : 'MISSING query');

  const seen = [];
  let text = '';

  const q = sdk.query({
    prompt: 'Reply with exactly: OK. Use no tools.',
    options: {
      cwd: path.join(__dirname, '..'),
      maxTurns: 1,
      permissionMode: 'default'
    }
  });

  for await (const message of q) {
    seen.push(message.type);
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') text += block.text;
      }
    }
    if (message.type === 'result') {
      console.log('result subtype :', message.subtype);
      console.log('session id     :', message.session_id);
      if (message.total_cost_usd !== undefined) {
        console.log('cost           : $' + message.total_cost_usd.toFixed(4));
      }
    }
  }

  console.log('message types  :', [...new Set(seen)].join(', '));
  console.log('assistant said :', JSON.stringify(text.trim().slice(0, 80)));
  console.log('elapsed        :', ((Date.now() - started) / 1000).toFixed(1) + 's');
})().catch((err) => {
  console.error('PROBE FAILED:', err.message);
  process.exit(1);
});
