// What each kind of agent would be doing if it were running for real: 20 tasks
// per role. The station uses these for standby "dummy jobs" (so idle agents look
// busy) and for demo mode. Real work always comes from events, never from here.
// Works in Node (require) and the browser (self.AcresTasks).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AcresTasks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TASKS = {
    boss: [
      "Plan today's work across all businesses",
      'Assign new Fiverr orders to the right worker',
      'Review thumbnails before they go to clients',
      'Spot-check clipped shorts for caption errors',
      'Reassign tasks stuck for over an hour',
      'Approve eBay and Marketplace prices before posting',
      'Read client messages and route them',
      'Check GEO audit drafts against the checklist',
      'Review the mobile game build notes',
      'Write the daily revenue summary',
      'Update the weekly goals board',
      'Flag anything that needs Derrick',
      'Check which agents are falling behind',
      'Balance workload between rooms',
      'Review failed tasks and retry plans',
      'Sort the incoming order queue by deadline',
      'Check delivery times against Fiverr promises',
      'Compare this week to last week',
      'Plan tomorrow\'s first tasks',
      'Archive finished work and notes',
    ],
    thumbnails: [
      'Read a new Fiverr thumbnail brief',
      'Pull key frames from the client video',
      'Cut out the subject from the best frame',
      'Pick a color scheme that pops on YouTube',
      'Write 3 headline options for the thumbnail',
      'Lay out text with heavy outlines',
      'Add glow and arrows to the focal point',
      'Make an A/B version with a different face',
      'Check readability at phone size',
      'Export 1280x720 PNGs under 2 MB',
      'Upload the delivery to Fiverr',
      'Answer a buyer question about revisions',
      'Apply client revision: bigger text',
      'Swap the background on revision request',
      'Build a reusable template for a channel',
      'Study trending thumbnails in the niche',
      'Update the gig gallery with new samples',
      'Reply to a new inquiry with a quote',
      'Ask a happy buyer for a review',
      'Organize the asset library',
    ],
    clipping: [
      'Download the client\'s long-form video',
      'Transcribe the full episode',
      'Score moments for strong hooks',
      'Pick the 8 best clip candidates',
      'Trim each clip to under 60 seconds',
      'Reframe clips to 9:16 vertical',
      'Track the speaker\'s face in frame',
      'Burn in word-by-word captions',
      'Add a hook title to the first second',
      'Insert B-roll on slow moments',
      'Balance audio and remove silences',
      'Add a progress bar and CTA end card',
      'Render clips in 1080x1920',
      'Write titles and hashtags for each clip',
      'Upload clips to the Fiverr delivery',
      'Apply a client\'s caption style revision',
      'Batch-render a monthly clip package',
      'Check clips for copyright music',
      'Reply to a buyer about turnaround time',
      'Pitch a monthly package to a repeat client',
    ],
    'geo-agency': [
      'Run 40 AI assistant queries for a client',
      'Log which competitors ChatGPT recommends',
      'Check Perplexity citations for the brand',
      'Check Gemini answers for the brand',
      'Score the client\'s AI visibility',
      'Find pages AI answers cite in the niche',
      'Draft FAQ content AI can quote',
      'Write schema markup for the services page',
      'Fix inconsistent business info across listings',
      'Draft a comparison page for the client',
      'Build the monthly AI visibility report',
      'Chart visibility change since last month',
      'Write the client summary email',
      'Research local businesses to prospect',
      'Run a free mini audit for a prospect',
      'Draft a personalized outreach email',
      'Follow up with prospects who opened',
      'Prep a sales call deck',
      'Update the service pricing sheet',
      'Track new AI search features this week',
    ],
    'mobile-games': [
      'Build the next level layout',
      'Code a new tile mechanic',
      'Fix a crash reported by testers',
      'Tune coin rewards per level',
      'Balance the shop prices',
      'Add a sound effect for combos',
      'Polish the level-complete animation',
      'Write unit tests for the scoring',
      'Profile frame rate on older phones',
      'Reduce the app download size',
      'Build a TestFlight release',
      'Write release notes for testers',
      'Read tester feedback and file bugs',
      'Design store screenshots',
      'Write the App Store description',
      'Research keywords for the store listing',
      'Set up analytics events for retention',
      'Check day-1 retention numbers',
      'Plan the next content update',
      'Fix a UI overlap on small screens',
    ],
    ebay: [
      'Check sold comps for a new item',
      'Photograph and crop item photos',
      'Write a keyword-rich listing title',
      'Fill in item specifics',
      'Write the item description',
      'Set price from recent sold listings',
      'Publish 5 new listings',
      'Reprice listings older than 30 days',
      'Send offers to watchers',
      'Answer a buyer question',
      'Print a shipping label',
      'Upload tracking for a sold item',
      'Leave feedback for a buyer',
      'Handle a return request',
      'Scan thrift finds for resale value',
      'Update the inventory sheet',
      'Calculate profit after fees',
      'Promote slow listings with ads',
      'Bundle related items into a lot',
      'End and relist stale listings',
    ],
    'fb-marketplace': [
      'Search nearby listings for underpriced flips',
      'Estimate resale value from local comps',
      'Message a seller to negotiate',
      'Plan a pickup route',
      'Write a Marketplace listing',
      'Set a price that leaves room to haggle',
      'Post 4 furniture items',
      'Reply to buyer messages',
      'Filter out lowball offers',
      'Confirm a pickup time and address',
      'Mark a sold item as sold',
      'Renew listings that went quiet',
      'Drop the price on slow items',
      'Log profit in the flip tracker',
      'Check local groups for demand',
      'Clean and stage an item for photos',
      'Cross-post an item to other apps',
      'Track which categories sell fastest',
      'Block a scam message',
      'Plan this weekend\'s sourcing',
    ],
    'job-apps': [
      'Search for new Account Executive roles',
      'Filter roles by OTE and location',
      'Check a company\'s funding and growth',
      'Tailor the resume to a posting',
      'Write a short cover note',
      'Fill in an application form',
      'Find the hiring manager on LinkedIn',
      'Draft a connection note under 300 characters',
      'Find a referral contact at the company',
      'Message a referral contact',
      'Follow up on an application after 5 days',
      'Log the application in the pipeline',
      'Prep talking points for a recruiter screen',
      'Research the interviewer',
      'Prep stories for a sales interview',
      'Practice a mock discovery call',
      'Send a thank-you note after an interview',
      'Update the pipeline\'s do-today list',
      'Track response rates by source',
      'Plan tomorrow\'s outreach',
    ],
    claude: [
      'Read the task and the codebase',
      'Search for where the change belongs',
      'Plan the change step by step',
      'Write the new function',
      'Update the related components',
      'Run the type checker',
      'Run the tests',
      'Fix a failing test',
      'Check it in the browser',
      'Fix a layout issue',
      'Write the commit message',
      'Push the branch',
      'Review the diff for mistakes',
      'Update the README',
      'Check the logs for errors',
      'Refactor a long function',
      'Add a missing edge case',
      'Answer a question about the code',
      'Update project memory',
      'Summarize what changed',
    ],
  };

  // How long a job of each kind takes, in minutes [min, max].
  const MINUTES = {
    boss: [4, 18], thumbnails: [12, 40], clipping: [20, 65], 'geo-agency': [25, 80], 'mobile-games': [30, 120],
    ebay: [6, 25], 'fb-marketplace': [5, 22], 'job-apps': [10, 45], claude: [3, 25],
  };
  // What a paid job is worth, in dollars [min, max]. Roles not listed don't bill per job.
  const PAY = { thumbnails: [15, 40], clipping: [25, 60], 'geo-agency': [60, 150], ebay: [20, 90], 'fb-marketplace': [15, 80] };
  function payFor(a) {
    for (const k of [a.script, a.id]) if (k && PAY[k]) return PAY[k];
    return null;
  }

  function minutesFor(a) {
    for (const k of [a.script, a.id]) if (k && MINUTES[k]) return MINUTES[k];
    return a.role === 'boss' ? MINUTES.boss : MINUTES.claude;
  }

  // Which list fits an agent: its "script" field, its id, or its project.
  function listFor(a) {
    const keys = [a.script, a.id, a.project && a.project.toLowerCase()];
    for (const k of keys) if (k && TASKS[k]) return TASKS[k];
    if (a.role === 'boss') return TASKS.boss;
    if (/^(thread-|claude-)/.test(a.id || '')) return TASKS.claude;
    return TASKS.claude;
  }

  return { TASKS, listFor, minutesFor, payFor };
});
