import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting notes sanitization...');

  const notes = await prisma.note.findMany();
  let updatedNotes = 0;

  for (const note of notes) {
    // Casting to string because the migration is already performed, 
    // but the script was written when content was a string.
    if (!isJsonString(note.content as unknown as string)) {
      console.log(`Sanitizing note ID: ${note.id} (title: "${note.title}")`);
      
      const newContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: note.content,
              },
            ],
          },
        ],
      };

      await prisma.note.update({
        where: { id: note.id },
        data: { content: JSON.stringify(newContent) },
      });

      updatedNotes++;
    }
  }

  console.log(`Updated ${updatedNotes} notes.`);

  console.log('Starting note versions sanitization...');
  const versions = await prisma.noteVersion.findMany();
  let updatedVersions = 0;

  for (const version of versions) {
    if (!isJsonString(version.content as unknown as string)) {
      console.log(`Sanitizing version ID: ${version.id}`);
      
      const newContent = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: version.content,
              },
            ],
          },
        ],
      };

      await prisma.noteVersion.update({
        where: { id: version.id },
        data: { content: JSON.stringify(newContent) },
      });

      updatedVersions++;
    }
  }

  console.log(`Updated ${updatedVersions} note versions.`);
  console.log('Sanitization completed successfully!');
}

function isJsonString(str: string): boolean {
  try {
    const parsed = JSON.parse(str);
    // Ensure that it's an actual serialized JSON (object/array), not a serialized null, boolean, or number.
    // Also, specifically for Tiptap, look for the 'type' property (preferably 'doc').
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

main()
  .catch((e) => {
    console.error('Error during sanitization:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
