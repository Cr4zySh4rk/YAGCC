// USB host port for authentication passthrough (structure after GP2040-CE usbhostmanager.cpp, MIT licence).
// Everything runs on core 0 in the main loop, next to the device stack, like GP2040-CE does.
#include "tusb.h"
#include "host/usbh.h"
#include "pio_usb.h"
#include "usb_host.h"
#include "ps4_auth.h"
#include "ps5_auth.h"
#include "xbone.h"
#include "xinput_host.h"

static bool running;
static uint8_t host_dp = 0xFF;

bool usb_host_running(void) { return running; }
bool usb_host_pin(uint8_t gpio) { return host_dp != 0xFF && (gpio == host_dp || gpio == host_dp + 1); }

bool usb_host_start(uint8_t dp_pin) {
    static pio_usb_configuration_t cfg = PIO_USB_DEFAULT_CONFIG;
    cfg.pin_dp = dp_pin;
    cfg.pinout = PIO_USB_PINOUT_DPDM;   // D- = D+ + 1
    cfg.pio_tx_num = 1;                 // PIO0 drives the fret LEDs, so the host port lives on PIO1
    cfg.sm_tx = 0;
    cfg.pio_rx_num = 1;
    cfg.sm_rx = 1;
    cfg.sm_eop = 2;
    cfg.tx_ch = 11;                     // a DMA channel nothing else uses
    host_dp = dp_pin;
    tuh_configure(BOARD_TUH_RHPORT, TUH_CFGID_RPI_PIO_USB_CONFIGURATION, &cfg);
    const tusb_rhport_init_t host_init = {.role = TUSB_ROLE_HOST, .speed = TUSB_SPEED_FULL};
    running = tusb_init(BOARD_TUH_RHPORT, &host_init);
    return running;
}

void usb_host_task(void) {
    if (running) tuh_task();
    ps4_auth_task();
    ps5_auth_task();
}

// ---------------------------------------------------------------- class driver for Xbox One controllers
extern "C" usbh_class_driver_t const *usbh_app_driver_get_cb(uint8_t *driver_count) {
    *driver_count = 1;
    return &xinput_host_driver;
}

extern "C" {
void tuh_xinput_mount_cb(uint8_t dev_addr, uint8_t instance) { xbone_host_mount(dev_addr, instance); }
void tuh_xinput_umount_cb(uint8_t dev_addr, uint8_t instance) { (void)instance; xbone_host_unmount(dev_addr); }
void tuh_xinput_report_received_cb(uint8_t dev_addr, uint8_t instance, uint8_t const *report, uint16_t len) {
    xbone_host_report(dev_addr, instance, report, len);
}

// ---------------------------------------------------------------- HID (DualShock 4 / PS4 auth dongles)
void tuh_hid_mount_cb(uint8_t dev_addr, uint8_t instance, uint8_t const *desc_report, uint16_t desc_len) {
    if (ps5_host_is_dongle(dev_addr)) ps5_host_mount(dev_addr, instance);   // P5General (PS5 mode)
    else ps4_host_mount(dev_addr, instance, desc_report, desc_len);
    tuh_hid_receive_report(dev_addr, instance);
}
void tuh_hid_umount_cb(uint8_t dev_addr, uint8_t instance) { (void)instance; ps4_host_unmount(dev_addr); ps5_host_unmount(dev_addr); }
void tuh_hid_report_received_cb(uint8_t dev_addr, uint8_t instance, uint8_t const *report, uint16_t len) {
    ps5_host_report(dev_addr, instance, report, len);   // the P5General's signed copies; other input is just drained
    tuh_hid_receive_report(dev_addr, instance);
}
void tuh_hid_set_report_complete_cb(uint8_t dev_addr, uint8_t idx, uint8_t report_id, uint8_t report_type, uint16_t len) {
    (void)report_type;
    if (len) ps4_host_set_report_complete(dev_addr, idx, report_id, len);
    ps5_host_set_report_complete(dev_addr, idx, report_id, len);
}
void tuh_hid_get_report_complete_cb(uint8_t dev_addr, uint8_t idx, uint8_t report_id, uint8_t report_type, uint16_t len) {
    (void)report_type;
    if (len) ps4_host_get_report_complete(dev_addr, idx, report_id, len);
    ps5_host_get_report_complete(dev_addr, idx, report_id, len);
}
}
