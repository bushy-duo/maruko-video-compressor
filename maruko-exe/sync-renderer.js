const fs = require('fs');
const path = require('path');
for (const name of ['index.html', 'app.js', 'app.css', 'tokens.css']) {
  fs.copyFileSync(path.join(__dirname, '..', 'ui-redesign', name), path.join(__dirname, 'renderer', name));
}
