// Evita la consola extra en Windows en la versión de publicación.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lector_pdf_lib::run()
}
