# Play Console - Data Safety Answers (draft, fill in exactly like this)

Data collected:
- Personal info: Email address (account creation, optional - guest play collects nothing), Name (the display name the player chooses, shown on leaderboards).
- App activity: Game progress, scores, in-game purchases entitlements, settings. Collected for app functionality and analytics-free leaderboards.
- App info and performance: crash and server error logs.

Data NOT collected: location, contacts, photos, files, financial info (Google Play handles payments), health, messages, browsing history, advertising ID by the app itself (AdMob SDK may collect ad data - declare under the AdMob section in the console, which Google pre-fills for the ads SDK).

Data shared: No data is sold. Processors: Google AdMob (ads), Google Play (billing), MongoDB Atlas (database hosting), Render (server hosting).

Security: Data encrypted in transit: Yes. Account deletion available in app: Yes (Profile - Delete Account). Data deletion URL (Play Console asks for one): use the privacy policy URL with a note, or host store/privacy-policy.md and add an account-deletion page describing the in-app path plus email hello@phoenixwebsites.ai for requests.

Account creation methods to declare: Email and password, Google Sign-In. Account is optional (guest mode).

# Content Rating Questionnaire Prep

- Violence: Yes, cartoon or fantasy violence, mild, against fictional creatures and a fantasy boss. No blood or gore depictions.
- Fear/horror: No.
- Sexuality: No.
- Language: No profanity.
- Controlled substances: No.
- Gambling: No simulated gambling, no loot boxes with random paid outcomes (all purchases are fixed, known items).
- User interaction: Users can see other players' display names and scores on leaderboards. No chat, no messaging, no content sharing.
- Digital purchases: Yes, in-app purchases including a subscription.
- Ads: Yes, ads are displayed (AdMob).
Expected outcome: Everyone 10+ (US), PEGI 7 range. Answer honestly in the console; do not understate.

# App Access / Review Notes (for the Play review team)

- The game works fully in guest mode with no login. Reviewers can tap Play immediately.
- To test an account: Sign Up with any email and password (8+ characters) and any display name.
- Ads and purchases run with Google test ad units and Play test products until launch; in this build, purchases complete through Play's test flow where configured.
- No restricted permissions are requested. The only permission declared is VIBRATE (haptics).
