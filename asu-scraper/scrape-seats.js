import { chromium } from 'playwright';

//---------------- PARAMETERS ----------------
const CHECK_INTERVAL_MINUTES = 5; // How often to check
const TOPIC = ''; // ntfy topic

const CLASS_SEARCH_NAME =       ['CSE 471', 'CSE 475']; // The class search page (eg. will search every 471 & 475 class in the fall semester)
const WHITELIST_CLASS_NUMBERS = ['85046',   '77919']; // Only these will be checked
const SKIP_CLASS_NUMBERS = []; // Use whitelist if you only care about specific classes

const TERM_NUMBER = '2257' //2<year><term> | 1: spring, 4: summer, 7: fall

const MAX_NOTIFICATIONS_PER_CLASS = 6; // Total notifications (every hour) before stopping
//--------------------------------------------

const BASE_URL = 'https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=C&honors=F&promod=F&searchType=all';
const URLS = CLASS_SEARCH_NAME.map(item => {
  const [subject, catalogNbr] = item.split(' ');
  return `${BASE_URL}&subject=${subject}&catalogNbr=${catalogNbr}&term=${TERM_NUMBER}`;
});

const notifyTracker = {}; // { [classNumber]: { lastSent: timestamp, interval: hours } }

async function checkClassesAndNotify(page, url) {
  //console.log(`[${new Date().toLocaleString()}] Checking classes at ${url}...`);
  await page.goto(url);
  await page.waitForSelector('.class-results-cell.seats');

  const classNames = await page.$$eval('.class-results-cell.course .bold-hyperlink', nodes => nodes.map(n => n.textContent.trim()));
  const titles = await page.$$eval('.class-results-cell.title .bold-hyperlink', nodes => nodes.map(n => n.textContent.trim()));
  const classNumbers = await page.$$eval('.class-results-cell.number > div', nodes => nodes.map(n => n.textContent.trim()));
  const instructors = await page.$$eval('.class-results-cell.instructor a', nodes => nodes.map(n => n.textContent.trim()));
  const locations = await page.$$eval('.class-results-cell.location', nodes => nodes.map(n => n.textContent.trim()));
  const seatInfos = await page.$$eval('.class-results-cell.seats .text-nowrap', nodes => nodes.map(n => n.textContent.trim()));

  const now = Date.now();

  const classes = classNames.map((_, i) => ({
    className: classNames[i] || '',
    title: titles[i] || '',
    classNumber: classNumbers[i] || '',
    instructor: instructors[i] || '',
    location: locations[i] || '',
    seats: seatInfos[i] || ''
  }))
  .filter(cls =>
    cls.title &&
    !SKIP_CLASS_NUMBERS.includes(cls.classNumber) &&
    (
      WHITELIST_CLASS_NUMBERS.length === 0 ||
      WHITELIST_CLASS_NUMBERS.includes(cls.classNumber)
    )
  );

  for (const cls of classes) {
    const openSeats = parseInt(cls.seats.split(' ')[0], 10);
    if (openSeats > 0) {
      const tracker = notifyTracker[cls.classNumber] || { lastSent: 0, interval: 1, notificationCount: 0 };
      const nextSend = tracker.lastSent + tracker.interval * 60 * 60 * 1000;
      
      if (tracker.notificationCount >= MAX_NOTIFICATIONS_PER_CLASS) {
        console.log(`Max notifications (${MAX_NOTIFICATIONS_PER_CLASS}) reached for class ${cls.classNumber} (${cls.title}). Skipping.`);
      } else if (now >= nextSend) {
        const message = `OPEN SEAT: ${cls.className}\n${cls.title}\nInstructor: ${cls.instructor}\nLocation: ${cls.location}\nSeats: ${cls.seats}`;
        await fetch(`https://ntfy.sh/${TOPIC}`, { method: 'POST', body: message });
        console.log(`[${new Date().toLocaleString()}] ntfy notification sent for class ${cls.classNumber}:`);
        console.log(message, '\n');
        console.log(`Next notification for class ${cls.classNumber} in ${tracker.interval} hour(s). (${tracker.notificationCount + 1}/${MAX_NOTIFICATIONS_PER_CLASS})\n`);
        notifyTracker[cls.classNumber] = { lastSent: now, interval: 1, notificationCount: tracker.notificationCount + 1 };
      } else {
        const minsLeft = Math.ceil((nextSend - now) / (60 * 1000));
        console.log(`Skipping notification for class ${cls.classNumber} (${cls.title}): open seats (${openSeats}), next notification in ${minsLeft} min(s). (${tracker.notificationCount}/${MAX_NOTIFICATIONS_PER_CLASS})`);
      }
    } else {
      if (notifyTracker[cls.classNumber] && notifyTracker[cls.classNumber].notificationCount > 0) {
        console.log(`Seats closed for class ${cls.classNumber} (${cls.title}), resetting notification count.`);
        notifyTracker[cls.classNumber] = { lastSent: 0, interval: 1, notificationCount: 0 };
      } else {
        console.log(`(${cls.classNumber}) No open seats: ${cls.className}, Instructor: ${cls.instructor}, Location: ${cls.location}`)
      }
      
    }
  }

  //console.log('Check complete.\n');
}

// Run all checks in parallel (1 browser multiple pages)
async function runAllChecks() {
  console.log(`\n[${new Date().toLocaleString()}] Checking Classes:`);

  const browser = await chromium.launch({ headless: true });
  const pages = await Promise.all(URLS.map(() => browser.newPage()));

  await Promise.all(
    URLS.map((url, i) => checkClassesAndNotify(pages[i], url))
  );

  await browser.close();
  console.log(`Next check in ${CHECK_INTERVAL_MINUTES} minutes...`);
}
setInterval(runAllChecks, CHECK_INTERVAL_MINUTES * 60 * 1000);
runAllChecks();
