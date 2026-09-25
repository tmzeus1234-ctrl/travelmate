// ===== PASTE YOUR OWN FIREBASE CONFIG HERE =====
// Get this from: Firebase Console -> Project Settings -> Your apps -> Web app
const firebaseConfig = {
  apiKey:  "AIzaSyDJSnzbg0sr-9Fua1YmMJrHnq9zbyCz9tQ",
  authDomain: "travel-mate-cde38.firebaseapp.com",
  projectId: "travel-mate-cde38",
  storageBucket: "travel-mate-cde38.firebasestorage.app",
  messagingSenderId:"195618215240",
  appId: "1:195618215240:web:a34a6a58a4610c55428f7d",
  databaseURL: "https://travel-mate-cde38-default-rtdb.firebaseio.com" // needed for live location
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const rtdb = firebase.database();
