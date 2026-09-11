// Restore the CMS database to the built-in default content.
//   npm run db:reset
import { getContent, replaceContent } from '../src/server/db';
import { SEED } from '../src/shared/seed';

replaceContent(SEED);
const content = getContent();
console.log(`Đã khôi phục dữ liệu mặc định: ${content.units.length} lính, ${content.maps.length} bản đồ, ${content.bots.length} bot.`);
