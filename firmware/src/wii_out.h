// Wired Wii extension output: the guitar answers a Wii Remote's extension port (I2C, address 0x52, with the
// Wii Remote's extension encryption) as a Guitar Hero guitar extension, with Santroller's
// lib/wii_extension_emulation. For Guitar Hero / Band Hero on a Wii with the Wii Remote in the guitar, the way
// the original Wii guitars work. Runs alongside the USB modes.
#ifndef YACC_WII_OUT_H_
#define YACC_WII_OUT_H_
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
#define WII_EXT_REPORT_LEN 6
void wii_out_task(const uint8_t report[WII_EXT_REPORT_LEN]);
bool wii_out_active(void);       // a Wii Remote is reading the extension
bool wii_out_pin(int gpio);      // SDA / SCL of the extension port (not buttons)
#ifdef __cplusplus
}
#endif
#endif
