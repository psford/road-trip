import SwiftUI

/// App entry point. `@main` marks the type that owns the app lifecycle;
/// `App` is the SwiftUI protocol whose `body` returns the scene graph.
@main
struct RoadTripApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
