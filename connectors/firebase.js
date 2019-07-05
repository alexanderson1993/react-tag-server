// =============================================================================
// Create the firebase connector for GraphQL
// =============================================================================
const admin = require("firebase-admin");
const settings = { timestampsInSnapshots: true };

// Delete the firebase admin app if it is already created (to avoid the error: Default App already exists)
if (admin.apps.length) {
  admin.app().delete();
}

// Create admin app using the function credentials
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG)),
  databaseURL: "https://react-tag.firebaseio.com"
});
// Create and configure the firestore client
const firestore = admin.firestore();
firestore.settings(settings);

const auth = admin.auth;
const storage = admin.storage;

module.exports = admin;

module.exports.firestore = firestore;
module.exports.auth = auth;
module.exports.storage = storage;
