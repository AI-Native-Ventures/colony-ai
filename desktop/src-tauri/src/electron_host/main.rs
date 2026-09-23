// A separate executable keeps ordinary Tauri builds from ever opening the
// private Electron transport.
fn main() {
    if std::env::var("COLONY_ELECTRON_HOST").as_deref() != Ok("1") {
        eprintln!("colony-native-host must be launched by the Electron parent");
        std::process::exit(1);
    }
    buzz_lib::run();
}
