import SwiftUI
import MapKit

/// A focused `MKMapView` bridge for picking a coordinate the native way (Apple Maps style):
/// long-press to drop a pin, then drag the pin to fine-tune. SwiftUI's `Map` (iOS 17/18)
/// can't do reliable long-press-with-coordinate or a draggable annotation, so per the
/// project's SwiftUI-first-but-best-practices-win guideline we drop to UIKit for this one
/// surface. Pan/zoom stay fully native.
struct LocationPickerMap: UIViewRepresentable {
    /// The chosen coordinate. `nil` until the user drops a pin (the no-GPS case).
    @Binding var coordinate: CLLocationCoordinate2D?
    /// Where to center initially when there's no coordinate yet (e.g. the trip's area).
    var initialRegionCenter: CLLocationCoordinate2D?

    private static let usCenter = CLLocationCoordinate2D(latitude: 39.5, longitude: -98.35)

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsUserLocation = true

        let center = coordinate ?? initialRegionCenter ?? Self.usCenter
        let span = (coordinate ?? initialRegionCenter) != nil
            ? MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
            : MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 30)
        map.setRegion(MKCoordinateRegion(center: center, span: span), animated: false)

        let longPress = UILongPressGestureRecognizer(
            target: context.coordinator, action: #selector(Coordinator.handleLongPress(_:)))
        longPress.minimumPressDuration = 0.4
        map.addGestureRecognizer(longPress)

        context.coordinator.mapView = map
        if let coordinate { context.coordinator.placeAnnotation(at: coordinate) }
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.syncAnnotation(to: coordinate)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var parent: LocationPickerMap
        weak var mapView: MKMapView?
        private var annotation: MKPointAnnotation?

        init(_ parent: LocationPickerMap) { self.parent = parent }

        @objc func handleLongPress(_ gesture: UILongPressGestureRecognizer) {
            guard gesture.state == .began, let map = mapView else { return }
            let point = gesture.location(in: map)
            let coordinate = map.convert(point, toCoordinateFrom: map)
            placeAnnotation(at: coordinate)
            parent.coordinate = coordinate
        }

        func placeAnnotation(at coordinate: CLLocationCoordinate2D) {
            if let annotation {
                annotation.coordinate = coordinate
            } else {
                let new = MKPointAnnotation()
                new.coordinate = coordinate
                annotation = new
                mapView?.addAnnotation(new)
            }
        }

        /// Keeps the annotation in sync with the binding without fighting an in-progress drag.
        func syncAnnotation(to coordinate: CLLocationCoordinate2D?) {
            guard let coordinate else {
                if let annotation { mapView?.removeAnnotation(annotation); self.annotation = nil }
                return
            }
            if let annotation {
                if annotation.coordinate.latitude != coordinate.latitude
                    || annotation.coordinate.longitude != coordinate.longitude {
                    annotation.coordinate = coordinate
                }
            } else {
                placeAnnotation(at: coordinate)
            }
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            if annotation is MKUserLocation { return nil }
            let id = "picker-pin"
            let view = (mapView.dequeueReusableAnnotationView(withIdentifier: id) as? MKMarkerAnnotationView)
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: id)
            view.annotation = annotation
            view.isDraggable = true
            view.animatesWhenAdded = true
            view.markerTintColor = .systemRed
            return view
        }

        func mapView(_ mapView: MKMapView, annotationView view: MKAnnotationView,
                     didChange newState: MKAnnotationView.DragState,
                     fromOldState oldState: MKAnnotationView.DragState) {
            switch newState {
            case .ending, .canceling:
                if let coordinate = view.annotation?.coordinate { parent.coordinate = coordinate }
                view.setDragState(.none, animated: true)
            default:
                break
            }
        }
    }
}
