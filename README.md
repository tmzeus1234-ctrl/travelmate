# Kerala Bus Tracker — Setup Guide

## 1. Firebase setup
1. Go to https://firebase.google.com/ → Console → "Add project" (free).
2. In the project, go to **Build → Firestore Database** → Create database (start in **test mode**).
3. Go to **Build → Realtime Database** → Create database (start in **test mode**).
4. Go to **Project Settings (gear icon) → General → Your apps → Add app → Web (</>)**.
5. Copy the `firebaseConfig` object it gives you and paste it into `firebase-config.js`, replacing the placeholder values. Also copy the `databaseURL` shown for your Realtime Database into that same file.

## 2. Add sample data to Firestore
In the Firestore console, create a collection called `routes`. Add a document (auto-ID) with fields:
```
name: "Kottayam - Kottarakara"
stops: ["Kottayam", "Changanassery", "Oyur", "Kottarakara"]
```
Add a second route document:
```
name: "Oyur - Kollam"
stops: ["Oyur", "Karunagappally", "Kollam"]
```
This lets the search find Kottayam → Kollam as a transfer route via Oyur.

Create a second collection called `buses`. Add a document per bus:
```
registrationNumber: "KL-07-AB-1234"
operator: "KSRTC"
busType: "Fast Passenger"
routeId: "<paste the auto-ID of the route doc it belongs to>"
departureTime: "09:15 AM"
```

## 3. Run it
- Open the folder in VS Code.
- Right-click `index.html` → "Open with Live Server" (install the Live Server extension first if you don't have it).
- Search a route, click a bus, and try the "Share My Location" button (allow location access in the browser).

## 4. Notes
- `liveLocations/{busId}` in Realtime Database is where live GPS coordinates get written when someone taps "Share My Location". Anyone viewing that bus's page listens to that same path.
- Firestore's test mode allows open read/write for 30 days — fine for a hackathon demo. Don't use test mode for anything beyond that.
- To demo the live tracking feature: open the same bus page on two devices/tabs — tap "Share" on one, watch the marker move on the other.
