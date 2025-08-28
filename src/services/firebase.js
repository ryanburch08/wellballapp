import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from 'firebase/storage';

const firebaseConfig = {                        
  apiKey: "AIzaSyCIQVg6b8jqebl1rxxgywoD654S-z3qYBo",
  authDomain: "wellball-app-36a67.firebaseapp.com",
  projectId: "wellball-app-36a67",
  storageBucket: "wellball-app-36a67.appspot.com",
  messagingSenderId: "420533978336",
  appId: "1:420533978336:web:f1cdf8d9fa6b30b395bc85"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);