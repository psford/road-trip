import SwiftUI

/// Phase 1 placeholder root view. Intentionally minimal — the design doc's
/// Phase 1 "Done when" is an app that builds and launches on the simulator.
/// TripListView (Phase 4) replaces this as the NavigationStack root.
struct ContentView: View {
    var body: some View {
        ContentUnavailableView(
            "Road Trip",
            systemImage: "map",
            description: Text("Native client scaffold — screens arrive in Phase 4.")
        )
    }
}

#Preview {
    ContentView()
}
