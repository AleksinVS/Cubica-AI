const fs = require('fs');
const path = require('path');

const EXCLUDED = ['.git', 'node_modules', '.next', '.tmp', 'sandbox', 'draft'];
const MAX_DEPTH = 3;

function readJsonFileStrict(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const relativePath = path.relative(process.cwd(), filePath) || filePath;
    throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function getDescriptions(dirPath) {
  const descs = {};
  
  // 1. package.json fallback for directory
  const pkgPath = path.join(dirPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = readJsonFileStrict(pkgPath);
    if (pkg.description) descs['.'] = pkg.description;
  }

  // 2. .desc.json overrides and file descriptions
  const descPath = path.join(dirPath, '.desc.json');
  if (fs.existsSync(descPath)) {
    const parsed = readJsonFileStrict(descPath);
    Object.assign(descs, parsed);
  }
  
  return descs;
}

function buildTree(dirPath, rootPath = process.cwd(), depth = 0) {
  if (depth > MAX_DEPTH) {
     return { node: "directory...", hasDescribedContent: false };
  }

  const descs = getDescriptions(dirPath);
  const result = {
    _isDir: true,
    desc: descs['.'] || null,
    children: {}
  };

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (e) {
    return { node: "unreadable...", hasDescribedContent: false };
  }

  // Sort
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  let hasDescribedContent = result.desc !== null;

  for (const entry of entries) {
    if (EXCLUDED.includes(entry.name) || entry.name.startsWith('.desc')) continue;
    
    const entryDesc = descs[entry.name] || null;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const childTreeInfo = buildTree(fullPath, rootPath, depth + 1);
      
      // We keep the child directory if it has its own description, or described files inside it, 
      // OR if it's explicitly defined in the parent's descs
      if (childTreeInfo.hasDescribedContent) {
         if (entryDesc && !childTreeInfo.node.desc) {
            childTreeInfo.node.desc = entryDesc; // fallback to parent's description
         }
         result.children[entry.name] = childTreeInfo.node;
         hasDescribedContent = true;
      } else if (entryDesc) {
         // Has description from parent, but no children described. Include it.
         if (typeof childTreeInfo.node === 'object') {
             childTreeInfo.node.desc = entryDesc;
         }
         result.children[entry.name] = childTreeInfo.node;
         hasDescribedContent = true;
      }
    } else {
      // It's a file
      if (entryDesc) {
        result.children[entry.name] = { _isDir: false, desc: entryDesc };
        hasDescribedContent = true;
      }
    }
  }

  return { node: result, hasDescribedContent };
}

const treeInfo = buildTree(process.cwd());

const header = `# PROJECT STRUCTURE
# =================
# AUTO-GENERATED FILE - DO NOT EDIT MANUALLY.
# Use \`node scripts/dev/generate-structure.js\` to update.
# This file provides a machine-readable overview of the repository layout.
# Note: 'draft', 'sandbox', '.tmp' and 'node_modules' are excluded.
# Note: ONLY documented files and directories (via .desc.json or package.json) are shown.

`;

function toYaml(obj, indent = 0) {
  let yaml = '';
  const spaces = '  '.repeat(indent);
  
  if (typeof obj === 'string') {
     return obj; // e.g., "directory..."
  }

  for (const [key, node] of Object.entries(obj)) {
    if (!node) continue;
    
    const descStr = node.desc ? ` # ${node.desc.replace(/\\n/g, ' ')}` : '';
    
    if (node._isDir) {
       if (node.children === "directory..." || Object.keys(node.children).length === 0) {
          yaml += `${spaces}${key}: directory...${descStr}\n`;
       } else {
          yaml += `${spaces}${key}:${descStr}\n${toYaml(node.children, indent + 1)}`;
       }
    } else {
       yaml += `${spaces}${key}: file${descStr}\n`;
    }
  }
  return yaml;
}

fs.writeFileSync('PROJECT_STRUCTURE.yaml', header + toYaml(treeInfo.node.children));
console.log('PROJECT_STRUCTURE.yaml generated strictly with documented nodes.');
