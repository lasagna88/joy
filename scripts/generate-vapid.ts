import webPush from "web-push";

const vapidKeys = webPush.generateVAPIDKeys();

console.log("Add these to your .env.local:\n");
console.log(`VAPID_PUBLIC_KEY=${vapidKeys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapidKeys.privateKey}`);
