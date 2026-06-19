import SwiftUI
import MapKit
import CoreLocation

/// A modal for choosing a coordinate the native way (design AC4.3 + AC2.3): long-press the
/// map to drop a pin, then drag the pin to fine-tune (Apple Maps "drop + Move"). Backed by
/// `LocationPickerMap` (MKMapView). "Confirm" is disabled until a pin exists.
struct PinDropView: View {
    let title: String
    let confirmTitle: String
    let onConfirm: (CLLocationCoordinate2D) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var coordinate: CLLocationCoordinate2D?
    private let initialCoordinate: CLLocationCoordinate2D?

    init(initialCoordinate: CLLocationCoordinate2D?,
         title: String = "Drop a Pin",
         confirmTitle: String = "Use This Location",
         onConfirm: @escaping (CLLocationCoordinate2D) -> Void) {
        self.title = title
        self.confirmTitle = confirmTitle
        self.onConfirm = onConfirm
        self.initialCoordinate = initialCoordinate
        _coordinate = State(initialValue: initialCoordinate)
    }

    var body: some View {
        NavigationStack {
            LocationPickerMap(coordinate: $coordinate, initialRegionCenter: initialCoordinate)
                .ignoresSafeArea(edges: .bottom)
                .overlay(alignment: .bottom) {
                    if coordinate == nil {
                        Text("Touch and hold the map to drop a pin")
                            .font(.subheadline)
                            .padding(.horizontal, 16).padding(.vertical, 10)
                            .background(.regularMaterial, in: Capsule())
                            .padding(.bottom, 24)
                    } else {
                        Text("Drag the pin to adjust")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(.regularMaterial, in: Capsule())
                            .padding(.bottom, 24)
                    }
                }
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button(confirmTitle) {
                            if let coordinate { onConfirm(coordinate); dismiss() }
                        }
                        .disabled(coordinate == nil)
                    }
                }
        }
    }
}
