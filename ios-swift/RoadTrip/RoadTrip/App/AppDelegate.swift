import UIKit

/// The one reason this SwiftUI app needs a `UIApplicationDelegate`: background uploads.
///
/// When iOS relaunches the app *purely* to deliver completed background-`URLSession` events,
/// it calls this method with a completion handler we must invoke once those events drain (so
/// the system knows it can snapshot the UI and re-suspend us). We hand the handler to the
/// shared `BackgroundUploadSession`, which fires it from `urlSessionDidFinishEvents`.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == BackgroundUploadSession.backgroundIdentifier else {
            completionHandler(); return
        }
        // `RoadTripApp.init` already configured the shared session on this launch; ensure it's
        // live so the delegate callbacks reach us, then stash the handler.
        BackgroundUploadSession.shared?.activate()
        BackgroundUploadSession.shared?.saveBackgroundCompletionHandler(completionHandler)
    }
}
