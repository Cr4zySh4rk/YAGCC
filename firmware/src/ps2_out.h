// Wired PS2 controller port output: the guitar answers a PS2 (or PS1) on its controller port as a Guitar Hero
// guitar, with Santroller's PSX emulation (lib/psx_emulation). Runs alongside the USB modes: it stays quiet
// until the console polls the port, so the same guitar can be plugged into USB or a PS2.
#ifndef YACC_PS2_OUT_H_
#define YACC_PS2_OUT_H_
#include <stdint.h>
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
#define PS2_REPORT_LEN 6
void ps2_out_task(const uint8_t report[PS2_REPORT_LEN], bool allowed);   // main loop; allowed = PIO1 is free
bool ps2_out_active(void);                       // a console is polling the port
bool ps2_out_pin(int gpio);                      // one of the port's pins (not a button)
#ifdef __cplusplus
}
#endif
#endif
