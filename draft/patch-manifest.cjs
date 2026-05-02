const fs = require('fs');
const path = '/home/abc/projects/Cubica-AI/games/antarctica/ui/web/ui.manifest.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const draftText = "Антарктика - это огромный мир из воды, льда и снега, настолько огромный, что никто из его обитателей, кроме, пожалуй, китов, не представляет его размеров. Кроме гигантского материка,";

const screen = data.screens.S1_LEFT;
if (!screen) { console.log('S1_LEFT not found'); process.exit(1); }

// Traverse to cards-container inside main-content-area
const mainContent = screen.root.children.find(c => c.props?.cssClass === 'main-content-area');
if (!mainContent) { console.log('main-content-area not found'); process.exit(1); }

const cardsContainer = mainContent.children.find(c => c.props?.cssClass === 'cards-container topbar-cards-container');
if (!cardsContainer) { console.log('cards-container not found'); process.exit(1); }

for (const card of cardsContainer.children) {
  if (card.type === 'cardComponent') {
    card.props.text = draftText;
  }
}

fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
console.log('Patched S1_LEFT card texts');
