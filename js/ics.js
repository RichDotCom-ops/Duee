// duee. — ICS (iCalendar) Parser
// Works with Canvas, Google Classroom, Blackboard, Moodle .ics exports

const ICS = {

  // ── Parse raw ICS text into event objects ──
  parse(text) {
    // RFC 5545: unfold lines (continuation lines start with space/tab)
    text = text
      .replace(/\r\n[ \t]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    const events = [];
    const lines = text.split('\n');
    let current = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === 'BEGIN:VEVENT') {
        current = {};
      } else if (line === 'END:VEVENT') {
        if (current && current.SUMMARY) events.push(current);
        current = null;
      } else if (current) {
        const colonIdx = line.indexOf(':');
        if (colonIdx < 0) continue;
        const keyPart = line.slice(0, colonIdx);
        const value = line.slice(colonIdx + 1)
          .replace(/\\,/g, ',')
          .replace(/\\;/g, ';')
          .replace(/\\n/g, ' ')
          .replace(/\\\\/g, '\\')
          .trim();
        const key = keyPart.split(';')[0].toUpperCase();
        if (!current[key]) current[key] = value; // first occurrence wins
      }
    }

    return events;
  },

  // ── Parse ICS date string to { date, time, allDay } ──
  parseDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();

    // All-day: YYYYMMDD
    if (/^\d{8}$/.test(dateStr)) {
      return {
        date: `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}`,
        time: '23:59',
        allDay: true
      };
    }

    // DateTime: YYYYMMDDTHHmmss[Z]
    if (/^\d{8}T\d{6}/.test(dateStr)) {
      const y  = dateStr.slice(0, 4),
            mo = dateStr.slice(4, 6),
            d  = dateStr.slice(6, 8),
            h  = dateStr.slice(9, 11),
            mi = dateStr.slice(11, 13);
      return {
        date: `${y}-${mo}-${d}`,
        time: `${h}:${mi}`,
        allDay: false
      };
    }

    return null;
  },

  // ── Extract structured assignment from a VEVENT ──
  extractAssignment(event) {
    const summary = (event.SUMMARY || '').trim();
    const desc    = (event.DESCRIPTION || '').trim();
    const dateInfo = this.parseDate(event.DTSTART);

    if (!summary || !dateInfo) return null;

    // Skip obvious non-assignment calendar events
    const lc = summary.toLowerCase();
    const skip = ['holiday','spring break','winter break','fall break',
                  'office hours','campus closed','reading day','no class today'];
    if (skip.some(s => lc === s || lc.startsWith(s))) return null;

    let courseName = '';
    let asgnName   = summary;

    // Canvas format → "Course Name: Assignment Name"
    if (summary.includes(': ')) {
      const idx = summary.indexOf(': ');
      courseName = summary.slice(0, idx).trim();
      asgnName   = summary.slice(idx + 2).trim();
    }

    // Blackboard → course name in CATEGORIES field
    if (!courseName && event.CATEGORIES) {
      const cat = event.CATEGORIES.replace(/^Courses\s*[:/]\s*/i, '').trim();
      if (cat && cat.toLowerCase() !== 'moodle') courseName = cat;
    }

    // Try LOCATION field
    if (!courseName && event.LOCATION) {
      courseName = event.LOCATION.trim();
    }

    // Try description for course name
    if (!courseName && desc) {
      const cm = desc.match(/(?:course|class)[:\s]+([^\n\\,]+)/i);
      if (cm) courseName = cm[1].replace(/\\n.*/, '').trim();
    }

    // Extract course code from start of name e.g. "GEN 103 Final Exam" → course "GEN 103", name "Final Exam"
    if (!courseName) {
      const codeMatch = asgnName.match(/^([A-Z]{2,5}\s*\d{2,4}[A-Z]?)\s+(.+)$/);
      if (codeMatch) {
        courseName = codeMatch[1].replace(/\s+/, ' ').trim();
        asgnName   = codeMatch[2].trim();
      }
    }

    // Clean up name: remove attempt suffixes, "(Online)", "[brackets]", "(Due ...)"
    asgnName = asgnName
      .replace(/\s*-\s*Attempt\s*\d+\s*$/i, '')
      .replace(/\s*\(online\)\s*/gi, ' ')
      .replace(/\s*\[.*?\]\s*$/, '')
      .replace(/\s*\(due[^)]*\)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    // Auto-guess priority from keywords
    const lName = asgnName.toLowerCase();
    let priority = 'medium';
    if (['exam','midterm','final','project','presentation','thesis'].some(k => lName.includes(k))) priority = 'high';
    if (['reading','quiz','reflection','check-in'].some(k => lName.includes(k))) priority = 'low';

    return {
      name:          asgnName   || summary,
      courseName:    courseName || 'Other',
      dueDate:       dateInfo.date,
      dueTime:       dateInfo.time,
      priority,
      estimatedTime: '1.5',
      notes:         ''
    };
  },

  // ── Full pipeline: text → cleaned assignment list ──
  processFile(text) {
    const events = this.parse(text);

    // Keep assignments from up to 30 days ago onward (generous window)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const assignments = [];
    const seen = new Set();

    for (const ev of events) {
      const asgn = this.extractAssignment(ev);
      if (!asgn) continue;
      if (asgn.dueDate < cutoffStr) continue;

      // Deduplicate by name + date
      const key = `${asgn.name.toLowerCase()}|${asgn.dueDate}`;
      if (seen.has(key)) continue;
      seen.add(key);

      assignments.push(asgn);
    }

    assignments.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return assignments;
  },

  // ── Get unique course names from parsed assignments ──
  getCourseNames(assignments) {
    return [...new Set(assignments.map(a => a.courseName))].filter(Boolean);
  }
};
