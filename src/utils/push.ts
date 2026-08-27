import webpush from 'web-push'

webpush.setVapidDetails(
  'mailto:admin@sportsops.com',
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export async function sendPushNotification(subscription: webpush.PushSubscription, payload: string) {
  try {
    await webpush.sendNotification(subscription, payload)
  } catch (error) {
    console.error('Error sending push notification', error)
  }
}
