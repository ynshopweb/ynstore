// ============================================================
// FIREBASE CONFIGURATION
// Inisialisasi Firebase App, Auth, dan Firestore.
// File lain cukup import { auth, db, appId } from './config.js'
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Firebase Configuration (Project: ynstore-c602f)
const firebaseConfig = {
    apiKey: "AIzaSyD_Lec5cjzcikNIK0t_JA-oX6ky--UoOGc",
    authDomain: "ynstore-c602f.firebaseapp.com",
    projectId: "ynstore-c602f",
    storageBucket: "ynstore-c602f.firebasestorage.app",
    messagingSenderId: "207239538771",
    appId: "1:207239538771:web:e9ec0fe896b371f5607ea6",
    measurementId: "G-Q844PTQJFG"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// App Id untuk path Firestore multi-tenant
export const appId = typeof __app_id !== 'undefined' ? __app_id : 'ynstore-default-id';
