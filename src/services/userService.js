// src/services/userService.js
import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export async function ensureUserDoc(user) {
  if (!user) return null;
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    // Default role: staff if company email, else player
    const role = (user.email || '').toLowerCase().endsWith('@playwellball.com') ? 'staff' : 'player';
    await setDoc(ref, {
      email: user.email || '',
      displayName: user.displayName || '',
      role,
      createdAt: new Date()
    });
    return { role };
  }
  return snap.data();
}
