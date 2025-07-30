import { chromium } from 'playwright';

const CHECK_INTERVAL_MINUTES = 5;
const TOPIC = ''; //ntfy topic (pick something unique like: my-alert-1928AB)
const SKIP_CLASS_NUMBERS = ['80982'];
const WHITELIST_CLASS_NUMBERS = [/* '80982', '81203', '85046' */]; // Only these will be checked
const MAX_NOTIFICATIONS_PER_CLASS = 6; // Total notifications before stopping

const notifyTracker = {}; // { [classNumber]: { lastSent: timestamp, interval: hours } }

async function checkClassesAndNotify() {
  console.log(`[${new Date().toLocaleString()}] Checking classes...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://catalog.apps.asu.edu/catalog/classes/classlist?campusOrOnlineSelection=C&catalogNbr=471&honors=F&promod=F&searchType=all&subject=CSE&term=2257');
  await page.waitForSelector('.class-results-cell.seats');

  const classNames = await page.$$eval('.class-results-cell.course .bold-hyperlink', nodes => nodes.map(n => n.textContent.trim()));
  const titles = await page.$$eval('.class-results-cell.title .bold-hyperlink', nodes => nodes.map(n => n.textContent.trim()));
  const classNumbers = await page.$$eval('.class-results-cell.number > div', nodes => nodes.map(n => n.textContent.trim()));
  const instructors = await page.$$eval('.class-results-cell.instructor a', nodes => nodes.map(n => n.textContent.trim()));
  const locations = await page.$$eval('.class-results-cell.location .bold-hyperlink', nodes => nodes.map(n => n.textContent.trim()));
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
        //await fetch(`https://ntfy.sh/${TOPIC}`, { method: 'POST', body: message });
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
      }
      notifyTracker[cls.classNumber] = { lastSent: 0, interval: 1, notificationCount: 0 };
    }
  }

  await browser.close();
  console.log('Check complete.\n');
}

setInterval(checkClassesAndNotify, CHECK_INTERVAL_MINUTES * 60 * 1000);
checkClassesAndNotify();
