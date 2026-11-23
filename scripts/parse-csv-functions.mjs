import fs from 'fs';

const content = fs.readFileSync('knowletive_missing_trigger_functions.csv', 'utf8');

// The CSV format has multiline fields enclosed in quotes.
// Let's parse properly.
const regex = /^([a-zA-Z0-9_]+\(\)),([tf]),"([\s\S]*?)"(?=\r?\n[a-zA-Z0-9_]+\(\)|$)/gm;
let match;
const funcs = [];

while ((match = regex.exec(content)) !== null) {
  funcs.push({
    signature: match[1],
    securityDefiner: match[2] === 't',
    definition: match[3].replace(/""/g, '"')
  });
}

console.log(`Found ${funcs.length} functions in CSV:\n`);
funcs.forEach((f, idx) => {
  console.log(`${idx + 1}. ${f.signature} (SECURITY DEFINER: ${f.securityDefiner})`);
});

export { funcs };
