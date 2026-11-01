// Watchdog, reset reason, HardFault and stack overflow handling. See reliability.h for the scratch register layout.
#include "reliability.h"
#include <string.h>
#include "pico/stdlib.h"
#include "pico/bootrom.h"
#include "hardware/watchdog.h"
#include "hardware/structs/watchdog.h"
#include "hardware/sync.h"

#define WDT_START_MS 8000   // start-up: flash reads, radio firmware download, USB host start
#define WDT_RUN_MS   2000   // main loop; the longest legitimate stall is a flash sector erase + program (< 0.5 s)
#define CANARY 0x59414743u

uint8_t g_reset_reason, g_reset_count;
uint32_t g_reset_pc;

extern uint32_t __StackBottom;   // lowest address of core 0's stack (linker script)

void rel_init(void) {
    uint32_t s2 = watchdog_hw->scratch[2];
    bool wd = watchdog_caused_reboot();
    g_reset_reason = rel_decode(wd, wd && watchdog_enable_caused_reboot(), s2);
    g_reset_count = rel_count_next(g_reset_reason, s2);
    g_reset_pc = g_reset_reason == RR_HARDFAULT ? watchdog_hw->scratch[3] : 0;
    watchdog_hw->scratch[2] = rel_pack(g_reset_count, REL_CODE_NONE);
    watchdog_hw->scratch[3] = 0;
    __StackBottom = CANARY;   // the stack grows down towards this word: overwritten = overflow
    watchdog_enable(WDT_START_MS, true);
}
void rel_arm(void) { watchdog_enable(WDT_RUN_MS, true); }
void rel_bt_phase(bool starting) {
    watchdog_hw->scratch[2] = rel_pack(g_reset_count, starting ? REL_CODE_BTINIT : REL_CODE_NONE);
}
void rel_disarm(void) { watchdog_disable(); }
void rel_bootsel(void) { watchdog_disable(); reset_usb_boot(0, 0); }

static void __no_inline_not_in_flash_func(rel_reset)(uint8_t code, uint32_t pc) {
    watchdog_hw->scratch[3] = pc;
    watchdog_hw->scratch[2] = rel_pack(g_reset_count, code);
    hw_set_bits(&watchdog_hw->ctrl, WATCHDOG_CTRL_TRIGGER_BITS);   // immediate watchdog reset, armed or not
    for (;;) tight_loop_contents();
}

void rel_task(void) {
    watchdog_update();
    if (__StackBottom != CANARY) rel_reset(REL_CODE_STACK, 0);
}

void rel_fill_status(uint8_t *p) {
    p[0] = g_reset_reason;
    p[1] = g_reset_count;
    memcpy(p + 2, &g_reset_pc, 4);
}

// HardFault (null / wild pointer, bad stack, flash access while XIP is off ...): record it and reset instead of hanging.
// In RAM, so it works while flash is being written. r0 = the stacked frame; its word 6 is the faulting PC.
__attribute__((used))   // referenced only from the asm below: keep it (and its name) under LTO
void __no_inline_not_in_flash_func(rel_hardfault_c)(uint32_t *frame) {
    rel_reset(REL_CODE_HARDFAULT, frame ? frame[6] : 0);
}
void __attribute__((naked, section(".time_critical.isr_hardfault"))) isr_hardfault(void) {
    __asm volatile(
        ".syntax unified\n"
        "mov r0, lr\n"
        "movs r1, #4\n"
        "tst r0, r1\n"
        "bne 1f\n"
        "mrs r0, msp\n"
        "b 2f\n"
        "1: mrs r0, psp\n"
        "2: ldr r1, =rel_hardfault_c\n"
        "bx r1\n");
}
