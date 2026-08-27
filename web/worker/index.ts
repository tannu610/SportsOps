declare const self: ServiceWorkerGlobalScope

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'New Notification', body: 'You have a new update.' }
  
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/badge.png',
      data: data.url
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.notification.data) {
    event.waitUntil(self.clients.openWindow(event.notification.data))
  }
})
