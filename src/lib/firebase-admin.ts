import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

let firebaseConfig: any = {};
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (error) {
  console.warn('Failed to load firebase-applet-config.json safely:', error);
}

if (!getApps().length && firebaseConfig.projectId) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

let _adminAuth: any = null;
export const adminAuth = new Proxy({} as any, {
  get(target, prop, receiver) {
    if (!_adminAuth) {
      if (!getApps().length) {
        throw new Error("Firebase Admin is not initialized. Please configure Firebase.");
      }
      _adminAuth = getAuth();
    }
    return Reflect.get(_adminAuth, prop, receiver);
  }
});
