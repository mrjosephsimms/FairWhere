import UIKit
import Capacitor

/// The app's web view controller (Main.storyboard). Registers plugins that live in this app
/// rather than in an npm package.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
