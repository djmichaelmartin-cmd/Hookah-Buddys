const fs = require('fs');
const path = require('path');

function findFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(findFiles(file));
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      results.push(file);
    }
  });
  return results;
}

const files = findFiles('artifacts/web/src');

const imports = [
  'BusinessDetail',
  'BusinessServiceItem',
  'BusinessProductItem',
  'BusinessOfferItem',
  'BusinessEventItem',
  'BusinessReviewItem',
  'BusinessMediaItem',
  'BusinessAlbumItem',
  'BusinessPostItem',
  'BusinessFollower',
  'BusinessCheckInPublic',
  'BusinessMentionItem',
  'BusinessNotificationItem',
  'BusinessTeamMemberItem',
  'BusinessChildCommentItem',
  'BusinessContentReportItem',
  'BusinessConversationItem',
  'BusinessMessageItem',
  'BusinessAppointmentItem',
  'BusinessSummary'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  
  const toImport = [];
  for (const imp of imports) {
    if (content.includes(imp)) {
      // Check if it's already imported
      const importRegex = new RegExp(`import\\s+{[^}]*\\b${imp}\\b[^}]*}\\s+from\\s+['"]@workspace\\/api-client-react['"]`);
      if (!importRegex.test(content)) {
        toImport.push(imp);
      }
    }
  }

  if (toImport.length > 0) {
    const apiImportMatch = content.match(/import\s+{([^}]*)}\s+from\s+['"]@workspace\/api-client-react['"]/);
    if (apiImportMatch) {
      const existing = apiImportMatch[1];
      const newImport = `import { ${existing}, ${toImport.join(', ')} } from "@workspace/api-client-react"`;
      content = content.replace(apiImportMatch[0], newImport);
      changed = true;
    } else {
      content = `import { ${toImport.join(', ')} } from "@workspace/api-client-react";\n` + content;
      changed = true;
    }
  }
  
  if (changed) {
    fs.writeFileSync(file, content);
  }
}
