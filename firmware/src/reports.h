// Per-mode report packers (firmware 0.42): the generic pad from padmap.c -> the native report of a USB personality.
// With the default map every report is byte for byte what 0.41 produced; the host tests in tests/host_map check it.
#ifndef YACC_REPORTS_H_
#define YACC_REPORTS_H_

#include <stdint.h>
#include "padmap.h"

#define RPT_XINPUT_LEN 20
#define RPT_PS3_LEN    27
#define RPT_HID_LEN    7
#define RPT_SWITCH_LEN 8
#define RPT_OGXBOX_LEN 20
#define RPT_PS4_LEN    64
#define RPT_PS5_LEN    64
#define RPT_XBONE_LEN  32   // GIP input body after the 4 byte header

uint16_t rpt_xinput(const gpad_t *g, uint8_t *out);
uint16_t rpt_ps3(const gpad_t *g, uint8_t *out);
uint16_t rpt_ps3_rb(const gpad_t *g, uint8_t *out);
uint16_t rpt_switch(const gpad_t *g, uint8_t *out);
uint16_t rpt_ogxbox(const gpad_t *g, uint8_t *out);
uint16_t rpt_hid(const gpad_t *g, uint8_t *out);
uint16_t rpt_ps4(const gpad_t *g, uint8_t *out);   // byte 7 holds only the PS bit: the sender ORs the counter in
uint16_t rpt_ps5(const gpad_t *g, uint8_t *out);
void rpt_xbone(const gpad_t *g, uint8_t *out);

#endif
