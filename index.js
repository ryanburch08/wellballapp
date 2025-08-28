/* Cloud Functions: set staff/user roles via custom claims, and auto-assign
   role on new user creation based on email domain.  */

const admin = require('firebase-admin');
admin.initializeApp();

const {onCall,HttpsError} = require('firebase-functions/v2/https');
const {onUserCreated} = require('firebase-functions/v2/identity');

// Adjust to your org emails
const STAFF_DOMAINS = ['wellball.com','wellball.app'];

/**
 * When a user is created, assign a default role.
 * - If email domain matches STAFF_DOMAINS → role='staff'
 * - Otherwise role='user'
 */
exports.onUserCreatedSetDefaultRole = onUserCreated(async(event) => {
  const user = event.data;
  const email = (user.email || '').toLowerCase();
  let role = 'user';
  if (email && STAFF_DOMAINS.some(d => email.endsWith('@' + d))) {
    role = 'staff';
  }
  await admin.auth().setCustomUserClaims(user.uid, {role});
});

/**
 * Privileged callable to set a user's role.
 * Caller must already be staff or admin.
 * Usage:
 *   functions:call setUserRole --data '{"uid":"<UID>","role":"staff"}'
 */
exports.setUserRole = onCall({region:'us-central1'}, async(request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated','Sign in required');

  const caller = await admin.auth().getUser(callerUid);
  const claims = caller.customClaims || {};
  const callerIsStaff = claims.role === 'staff' || claims.admin === true;
  if (!callerIsStaff) throw new HttpsError('permission-denied','Staff only');

  const data = request.data || {};
  const uid = data.uid;
  const role = data.role;
  const allowed = ['user','staff','admin'];
  if (!uid || !allowed.includes(role)) {
    throw new HttpsError('invalid-argument','Provide {uid, role} with role in '+allowed.join(','));
  }

  await admin.auth().setCustomUserClaims(uid, {role});
  return {status:'ok',uid,role};
});
