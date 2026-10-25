# Play Console Data safety answer map

Use this as the working answer sheet during submission. The form changes over time, and the Google Mobile Ads SDK disclosure must be checked again on the day the form is submitted. Do not answer that the app collects no data: accounts, leaderboards, purchases, and AdMob all involve data.

## Overview answers

- Does the app collect or share user data? Yes.
- Is data encrypted in transit? Yes. Backend and Google service traffic uses HTTPS or TLS.
- Can users request data deletion? Yes.
- Account creation supported? Yes, email and password or Google sign-in.
- Account deletion available in app? Yes, from the profile screen.
- Account deletion web URL: use the public URL where `ACCOUNT-DELETION.md` is published.
- Privacy policy URL: use the public URL where `PRIVACY-POLICY.md` is published.
- Does the developer sell user data? No.

## Data handled by the Phoenix backend

| Play data type | Collected | Shared | Required or optional | Purposes | Notes |
| --- | --- | --- | --- | --- | --- |
| Email address | Yes | No | Optional, only for an account | App functionality, account management, fraud prevention, security and compliance | Guest play does not require email. |
| Name | Yes | Yes, public leaderboard display | Optional, only for an account | App functionality, account management | This is the player-chosen username. It is public on leaderboards. |
| User IDs | Yes | No, other than service processing | Optional, only for an account | App functionality, account management, fraud prevention, security and compliance | Includes the internal account ID and Google account identifier for Google sign-in. |
| Purchase history | Yes | No, other than Google Play processing | Optional | App functionality, fraud prevention, security and compliance, account management | We store product, entitlement, order or token reference, and subscription expiry. We do not receive full card details. |
| App interactions | Yes | No, other than service processing | Optional for synced account progress; guest data stays local | App functionality, account management | Includes progress, level, XP, currency, unlocks, upgrades, trophies, and settings synced by the player. |
| Other in-app actions or gameplay activity | Yes | Limited public leaderboard fields | Optional for an account | App functionality | Includes campaign and battle scores. Only username, level, XP, trophies, and battle bests are selected for leaderboard display. |
| Other user-generated content | Yes | Yes, public username only | Optional | App functionality | The game has no chat, voice, photo upload, or free-form public posts. The username is the public user-generated content. |
| Crash logs and diagnostics | No from the Phoenix code | No | Not applicable | Not applicable | Do not claim a crash analytics product unless one is added later. The AdMob SDK row below is separate. |

## Google Mobile Ads SDK

AdMob is a third-party SDK. During submission, compare the current form options with Google's current Mobile Ads SDK data disclosure and declare the SDK data honestly.

Expected SDK data categories to verify:

- Device or other IDs, including advertising ID, for advertising, analytics, and fraud prevention.
- App interactions and ad interaction information for advertising and analytics.
- Approximate location or IP address if the current SDK disclosure lists it for advertising or ad delivery.
- Diagnostics and performance information if the current SDK disclosure lists it.

Mark data as shared when the form's definition applies to data transferred to Google as a third party. Do not mark Phoenix backend account data as sold.

## Data types not collected by the Phoenix code

- Precise location
- Health or fitness information
- Contacts
- Photos, videos, voice, or audio files from the user
- Calendar information
- SMS or call logs
- Browsing history outside the app
- Government IDs
- Payment card numbers in the Phoenix database

## Before submitting

1. Publish the privacy policy and account deletion pages.
2. Confirm every SDK in the final Android build, not only AdMob.
3. Recheck the Google Mobile Ads SDK disclosure for the SDK version shipped in the release.
4. Make sure the Data safety answers match the final binary. If a new analytics, crash, attribution, or push SDK is added, update this file and the form before release.
