# 사운드 매핑 대조표

원본 Escape From Tarkov 설치본(`E:\Program Files\EFT`)의 어떤 오디오가 이 게임의
어떤 큐를 받치고, 그 큐가 어느 코드 줄에서 울리는지를 전부 대조한 표다.

**파일명 추측이 아니다.** 세 지점에서 확정했다.

1. **클립 이름은 유니티 에셋 이름이다.** `tools/extract_tarkov_sfx.py`의 인덱서는
   UnityPy로 번들을 열어 `AudioClip` 오브젝트의 `m_Name` 필드를 읽는다
   (`extract_tarkov_sfx.py:97-114`). 디스크의 파일명이 아니라 BSG가 에셋에 붙인
   내부 식별자다. 인덱스에 32,815개가 들어 있다.
2. **`sfx_picks.py`의 클립 178개 큐분 전부가 그 인덱스에 존재한다.** 대조 결과
   미해결 0건, 매니페스트 누락 0건, 매니페스트에만 있고 픽에 없는 큐 0건.
3. **아이템 효과음은 BSG의 `ItemSound` 필드를 그대로 쓴다.** `build_items.py:300-301`이
   SPT 3.10.1 `items.json`의 `_props.ItemSound`를 `snd`로 복사하고, 게임은
   `item_<snd>_<action>` 이름의 큐를 요청한다. 그 이름은 `itemsounds.bundle` 안의
   실제 `AudioClip` 이름과 일치한다. 즉 **원본 게임이 쓰는 식별자로 원본 클립을 부른다.**

배포본 `assets/sfx-eft/pack.bin`을 실제로 복호화해 확인한 결과 파일 195개 / 큐 178개,
내부 매니페스트가 `assets/sfx-eft/manifest.json`과 바이트 단위로 동일하다.
로컬 추출본과 공개 배포본이 같은 매핑을 재생한다.

---

## 파이프라인

```
EFT 설치본                     추출/가공                  런타임
─────────────────────────      ───────────────────        ─────────────────────
sounds.bundle          ┐                                  manifest[cue] = [파일]
itemsounds.bundle      │   --index  AudioClip.m_Name              │
resources.assets       ├─► --search 이름 검색        ─────► play(cue) ─► 3버스
<무기>.bundle          │   sfx_picks.py  큐 ← 클립               (sfx/ui/ambient)
sharedassets537.assets ┘   --extract ffmpeg 트림/믹스/모노/ogg
                            pack_sfx.py  deflate + AES-256-GCM
```

추출 공정(`extract_tarkov_sfx.py:184-224`)은 모든 클립에 동일하게 적용된다 —
모노 다운믹스, 앞뒤 -50dB 무음 제거, 32kHz(앰비언스만 22.05kHz), libvorbis q2.
`trim [시작, 길이]`은 원본의 긴 잔향 꼬리를 자르기 위한 것이고, 목록이 중첩 리스트인
큐는 `amix`로 한 파일에 믹스된다(발소리 = 발자국 + 장비 소리).

---

## 컨테이너별 출처

| EFT 컨테이너 | 경로 | 큐 수 |
|---|---|---|
| `itemsounds.bundle` | `StreamingAssets\Windows\assets\content\audio\itemsounds\` | 153 |
| `resources.assets` | `EscapeFromTarkov_Data\` | 16 |
| `sounds.bundle` | `...\content\audio\prefabs\movement\` | 4 |
| `grach.bundle` / `sks.bundle` / `mr133.bundle` | `...\content\audio\weapons\` | 3 |
| `m4a1.bundle` | `...\content\audio\banks\` | 1 |
| `sharedassets537.assets` | `EscapeFromTarkov_Data\` | 1 |

> `stm9_fire_indoor_close`는 이름이 STM-9인데도 `stm9.bundle`이 아니라 **`m4a1.bundle`**
> 안에 들어 있다. 파일명으로 짐작했으면 틀렸을 자리다.

---

## 이동 — `sounds.bundle`

| 큐 | 원본 클립 | 가공 | 트리거 |
|---|---|---|---|
| `step_walk` | `walk_concrete1`–`6` + `gear_stereo1`–`6` (6쌍 믹스) | trim 0–1.2s, −1dB | 이동 중 + **장비 총중량 35kg 초과**. `raid-ui.js:80` |
| `step_run` | `run_concrete1`–`6` + `gear_stereo1`–`6` | trim 0–1.2s, −1dB | 이동 중 + 35kg 이하 (**기본 보행이 조깅이다**) |
| `step_sprint` | `sprint_metal1`–`6` + `gear_stereo1`–`6` | trim 0–1.2s, −1dB | 스프린트 중 |
| `step_stop` | `stop_metal1`, `2`, `3` | trim 0–1.4s | 직전 프레임까지 이동하다 멈춘 전환 프레임 1회. `raid-ui.js:83` |

Factory 바닥은 콘크리트에 금속 통로가 섞여 있어 걷기/달리기는 `concrete`,
스프린트는 `metal` 세트를 쓴다. `gear_stereo`는 원본에서 이동하는 플레이어의
장비가 흔들리는 소리로, 게임이 발자국 위에 겹쳐 재생하는 레이어다 — 여기서는
추출 단계에서 미리 믹스해 굽는다.

케이던스와 게인은 `audio.js:38-42`의 `STEP_MIX`가 정한다.

| 보행 | 최소 간격 | 게인 | 피치 랜덤 |
|---|---|---|---|
| walk | 430ms | 0.50 | 0.94–1.07 |
| run | 330ms | 0.55 | 0.97–1.09 |
| sprint | 265ms | 0.62 | 1.00–1.12 |

---

## 컨테이너 수색 — `itemsounds.bundle`

원본의 루팅 루프 10종을 전부 쓴다. 게임 안 컨테이너 23종이 **빠짐없이** 이 10종에
매핑되며, 폴백(`search_wood`)으로 떨어지는 타입은 없다.

| 큐 | 원본 클립 | 원본 길이 → trim | 컨테이너 타입 |
|---|---|---|---|
| `search_wood` | `woodbox_looting` | 8.28s → 5.5s | crate, ammobox, weaponbox, weaponbox6, grenadebox, rationcrate |
| `search_industrial` | `industrialbox_looting` | 10.45s → 6.0s | toolbox, suitcase, medcase, medcrate |
| `search_techno` | `techno_box_looting_01` | 14.40s → 6.0s | pcblock, techcrate |
| `search_bag` | `sportbag_looting` | 10.57s → 5.0s | sportbag, duffle, medbag |
| `search_jacket` | `jacket_looting` | 13.15s → 4.0s | jacket |
| `search_safe` | `safe_looting` | 7.35s → 5.0s | safe, banksafe |
| `search_drawer` | `drawer_wood_looting` | 8.76s → 4.0s | drawer |
| `search_metal` | `drawer_metal_looting` | 10.85s → 5.0s | filecab |
| `search_cash` | `cashregister_looting` | 5.06s → 3.0s | cashreg |
| `search_body` | `looting_body_extended` | 9.95s → 5.5s | deadscav, pmcbody |

**재생 방식이 다르다.** 이 큐들만 단발이 아니라 **루프 소스를 열어 두는 방식**이다
(`audio.js:445-478`). 수색 시작(`raid.js:293`)에 80ms 페이드인으로 열리고,
끝나거나(`raid.js:397`) 중단되면(`raid.js:307`) 120ms 페이드아웃으로 닫힌다.
아이템이 하나씩 나올 때마다 다시 울리지 않는다 — 원본도 그렇고, 초당 하나씩
발견되는 동안 4~6초 클립을 재트리거하면 같은 소리가 네 겹으로 쌓이기 때문이다.

**아이템 발견 효과음은 의도적으로 없다.** 원본에 그런 큐가 없다
(`sfx_picks.py:66-68`).

### 뚜껑 여는 소리

| 큐 | 원본 클립 | 길이 | 적용 컨테이너 |
|---|---|---|---|
| `open_metal` | `container_metal_open` | 0.55s (36,393Hz) | safe, banksafe, filecab / 인벤토리의 시큐어 컨테이너 |
| `open_case` | `container_case_open` | 0.61s | suitcase, medcase / 인벤토리의 그 외 컨테이너 |
| `open_pouch` | `container_pouch_open` | 0.71s | jacket, sportbag, duffle / 인벤토리의 배낭 |
| `open_plastic` | `container_plastic_open` | 0.51s | 나머지 15종 전부 |

`audio.js:496-502`의 분기가 수색 큐보다 훨씬 거칠다. 나무 상자(crate, ammobox,
weaponbox, grenadebox, rationcrate)와 시체(deadscav, pmcbody)까지 전부
`open_plastic`을 받는다 — 뒤적이는 소리는 재질별로 맞는데 여는 소리는 그렇지 않다.

`raid.js:289`의 이 호출은 `if (container.searched) return`보다 **앞**에 있어서,
이미 다 턴 컨테이너를 다시 열어도 뚜껑 소리는 항상 난다.

---

## 아이템 취급 — `itemsounds.bundle`

큐 이름을 런타임에 조립한다(`audio.js:428-437`):

```
item_<snd>_<pickup|drop|use>      snd = 아이템 템플릿의 ItemSound 값
```

`snd`가 없으면 `ITEM_CLASS[cat]`, 그것도 없으면 `generic`. 조립한 큐가 팩에 없으면
`item_generic_<action>`으로 폴백한다. **`play()`의 성공 여부가 아니라 `hasCue()`로
폴백을 판단한다** — 디코딩 중인 큐는 `false`를 반환하고 잠시 뒤 울리는데, 그걸
실패로 보면 그 위에 generic이 겹쳐 나기 때문이다.

> **폴백 경로는 현재 전부 죽어 있다.** 템플릿 194개 전부가 `snd`를 갖고 있고(누락 0),
> 호출부 6곳 전부가 문자열이 아니라 템플릿 객체를 넘기며, `snd` 40종 전부가 매니페스트에
> 큐를 갖는다. 따라서 `ITEM_CLASS` 테이블(`audio.js:82-93`)도 `item_generic_<action>`
> 폴백(`audio.js:436`)도 실제로는 한 번도 발동하지 않는다 — 새 아이템을 위한 방어 코드다.
> `item_generic_pickup`/`_drop`은 폴백이 아니라 `snd="generic"`인 아이템 40개가
> **직접** 요청해서 가장 자주 울린다.

현재 아이템 194개가 쓰는 `ItemSound` 값은 40종이다.

| `snd` | 아이템 수 | pickup | drop | use | 예 |
|---|---|---|---|---|---|
| `generic` | 40 | 0.72s | 0.73s | 0.63s | AA Battery |
| `gear_generic` | 12 | 0.30s | 0.57s | 0.96s | Documents case |
| `jewelry` | 10 | 0.64s | 0.31s | — | Physical Bitcoin |
| `med_medkit` | 9 | 0.34s | 0.53s | **6.31s** | Grizzly |
| `gear_backpack` | 9 | 0.71s | 0.66s | 1.41s | Duffle bag |
| `keys` | 8 | 0.25s | 0.34s | 0.63s | Factory emergency exit key |
| `weap_ar` | 8 | 1.00s | 0.78s | 0.73s | AK-74N |
| `ammo_singleround` | 7 | 0.19s | 0.27s | 0.20s | 5.45x39mm BP gs |
| `gear_armor` | 6 | 0.74s | 0.45s | 1.01s | 6B13 assault armor |
| `gear_goggles` | 6 | 0.56s | 0.58s | 0.81s | Peltor ComTac II |
| `container_plastic` | 6 | 0.29s | 0.26s | 0.81s | Item case |
| `container_case` | 5 | 0.15s | 0.54s | 0.33s | Secure container Alpha |
| `gear_helmet` | 5 | 0.43s | 0.46s | 0.50s | 6B47 Ratnik-BSh |
| `med_stimulator` | 4 | 0.19s | 0.44s | 1.93s | Morphine injector |
| `food_snack` | 4 | 0.54s | 0.42s | **7.54s** | Alyonka chocolate bar |
| `container_metal` | 4 | 0.31s | 0.61s | 0.46s | Ammunition case |
| `med_bandage` | 4 | 0.38s | 0.58s | **5.72s** | Army bandage |
| `spec_multitool` | 4 | 0.31s | 0.30s | — | Pliers Elite |
| `grenade` | 4 | 0.33s | 0.44s | — | F-1 hand grenade |
| `food_bottle` | 3 | 0.75s | 0.64s | 3.78s | Bottle of water (0.6L) |
| `item_money` | 3 | 0.35s | 0.38s | — | Roubles |
| `item_cloth_generic` | 3 | 0.51s | 0.34s | 1.06s | Paracord |
| `knife_generic` | 3 | 0.44s | 0.53s | 0.45s | 6Kh5 Bayonet |
| `food_tin_can` | 3 | 0.69s | 0.65s | 4.85s | Can of beef stew |
| `weap_pistol` | 3 | 0.98s | 0.40s | 0.72s | Makarov PM |
| `med_pills` | 2 | 0.29s | 0.43s | 0.57s | Analgin painkillers |
| `smallmetal` | 2 | 0.32s | 0.30s | — | Electric motor |
| `mag_plastic` | 2 | 0.28s | 0.24s | 0.27s | AK-74 6L20 30-round |
| `magazine_metal` | 2 | 0.53s | 0.44s | 0.41s | PM 8-round |
| `ammo_pack_generic` | 2 | 0.38s | 0.54s | 0.20s | Pack of nails |
| `food_juice_carton` | 2 | 0.72s | 0.73s | 3.02s | Pack of Vita juice |
| `ammo_shotgun` | 1 | 0.72s | 0.88s | 0.30s | 12/70 7mm buckshot |
| `spec_armorrep` | 1 | 0.42s | 0.54s | 2.94s | Car battery |
| `item_paper` | 1 | 0.46s | 0.33s | 0.75s | Slim diary |
| `item_map` | 1 | 0.35s | 0.40s | 0.94s | Factory plan map |
| `mod` | 1 | 0.23s | 0.24s | 0.55s | GPS Signal Amplifier |
| `food_soda_can` | 1 | 0.72s | 0.41s | 4.00s | Can of Hot Rod |
| `item_book` | 1 | 0.51s | 0.83s | 1.03s | Intelligence folder |
| `item_plastic_generic` | 1 | 0.46s | 0.41s | 0.85s | Rechargeable battery |
| `weap_pump` | 1 | 0.23s | 0.64s | 0.47s | MP-133 |

`—`는 원본 번들에 `_use` 클립이 아예 없는 클래스다(`sfx_picks.py:133`의 `_NO_USE`:
grenade, item_money, jewelry, smallmetal, spec_multitool). 이 경우 `sfx.use()`는
`item_<cls>_pickup`으로 대체한다.

**pickup/drop은 trim 0–2.0s, use는 0–3.5s** 로 자른다. `food_snack_use`(7.54s)나
`med_medkit_use`(6.31s)처럼 원본이 긴 것들은 앞 3.5초만 쓴다.

### 아이템 효과음 호출 지점

| 코드 | 액션 | 트리거 |
|---|---|---|
| `dnd.js:166` | `pickup` | 드래그 문턱 4px을 넘겨 아이템이 칸에서 손에 들리는 순간 |
| `dnd.js:281` | `drop` | 그리드 칸에 내려놓아 `moveToGrid`가 성공한 순간 |
| `dnd.js:320` | `pickup` | Ctrl+클릭 퀵 이동으로 `autoPlace`가 성공 |
| `dnd.js:324` | `pickup` | Ctrl+클릭 퀵 이동에서 스택 일부만 합쳐졌을 때 |
| `examine.js:66` | `pickup` | 미확인 아이템 검사(Examine)가 시작될 때 |
| `raid-ui.js:433` | `use` | 레이드 오버레이에서 `res`가 남은 meds/food/drink를 USE |

---

## 인터페이스 — `resources.assets`

| 큐 | 원본 클립 | 길이 | 버스/게인 | 트리거 |
|---|---|---|---|---|
| `ui_click` | `button_click` | 0.42s | ui 0.45 | `.btn`/`.seg`/`.map-card` 클릭(`shell.js:76`), 은신처 탭(`:64`), 컨텍스트 메뉴 항목(`dialogs.js:53`), 드래그 중 회전(`dnd.js:127`) |
| `ui_hover` | `button_over` | 0.14s | ui 0.22, 60ms 제한, −6dB | `.btn`/`.seg`/`.ttab`/`.map-card` 진입(`shell.js:72`), 은신처 탭(`:65`) |
| `ui_context` | `menu_context_menu` | 0.14s | ui 0.40 | 아이템 우클릭으로 컨텍스트 메뉴가 실제로 뜰 때(액션 0개면 무음) |
| `ui_error` | `error_message` | 0.33s | ui 0.50, **400ms 제한** | `toast()`가 `warn`/`bad`로 호출될 때(`shell.js:38`) + 거래 거부 6곳 직접 호출 |
| `ui_close` | `menu_escape` | 0.15s | ui 0.35 | 컨테이너 창 X 버튼(`window.js:75`), 레이드 오버레이 닫힘(`raid-ui.js:315`) |
| `ui_window_open` | `menu_open_container` | 0.33s | ui 0.45 | 레이드 인벤토리 오버레이가 닫힘→열림(`raid-ui.js:308`) |
| `ui_inspect_open` | `menu_inspector_window_open` | 0.17s | ui 0.40 | 모달이 열릴 때 전부 — INSPECT, SPLIT, 확인 대화상자, PROFILE |
| `ui_inspect_close` | `menu_inspector_window_close` | 0.10s | ui 0.40 | 모달이 닫힐 때 전부 — ESC, 배경 클릭, CLOSE/CANCEL/CONFIRM |
| `ui_equip` | `clothes_equip` | 0.91s | **sfx** 0.55 | 드래그로 장비 슬롯에 착용 성공(`dnd.js:286`) |
| `ui_exp` | `notification_exp` | 0.57s | ui 0.40, 900ms 제한 | 프로필 레벨이 실제로 오른 순간(`shell.js:61`) |

`ui_equip`만 ui 버스가 아니라 **sfx 버스**다 — 인터페이스 소리가 아니라 실제 착용
폴리로 취급한다.

---

## 거래 — `resources.assets`

| 큐 | 원본 클립 | 길이 | 트리거 |
|---|---|---|---|
| `trade_tab` | `menu_trader_press` | 0.65s | 초상화 탭에서 **다른** 상인으로 전환(`trade.js:282`) |
| `trade_click` | `trade_click_button` | 0.42s | BUY/SELL 세그먼트 전환(`:97`), 오퍼를 테이블에 올림(`:468`), CLEAR(`:495`, `:641`), 수량 −/+(`:527`), ALL(`:542`) |
| `trade_buy` | `buy_button_click` | 0.84s | **Fill items** 로 결제 금액 할당(`:560`) |
| `trade_deal` | `trade_operation_complete` | 1.21s | 구매 커밋 성공(`:620`), 판매 DEAL! 진입(`:683`) |

> `trade.js:683`의 판매 성사음은 지급액 계산과 `canAddMoney` 검사보다 **앞줄**이라,
> 이후 "No room in the stash for the payout"으로 판매가 취소돼도 소리는 이미 난 뒤다.

---

## 레이드 결과 · 앰비언스 · 총성

| 큐 | 원본 클립 | 출처 | 트리거 |
|---|---|---|---|
| `extract_done` | `quest_completed` (4.99s → 3.5s) | `resources.assets` | 탈출 지점에서 6초 홀드 완주(`raid.js:638`) |
| `death` | `fp_death_heartbeat` (9.24s → 4.0s) | `resources.assets` | `finish(KIA)` — HP 0. MIA/LEFT는 무음 |
| `amb_factory` | `amb_factory_rework_day_loop` (87.82s 전체, 22.05kHz, −2dB) | `sharedassets537.assets` | 레이드 화면 진입 시 2.5초 페이드인(`raid-ui.js:50`), 종료 시 0.8초 페이드아웃(`:477`) |

탈출음에 원본의 탈출 큐가 아니라 **퀘스트 완료음**을 쓴다. 앰비언스는 87초를 통째로
써서 루프 지점이 잘 들리지 않게 했고, 팩에 없으면 `audio.js:571-609`의 합성 드론
(47Hz 톱니 + 70.5Hz 사인 + 밴드패스 노이즈)으로 대체된다.

### 총성 — 무기별 뱅크

전부 **`_fire_indoor_close`** 변형이다. Factory가 지붕 덮인 공장이라 실내 반사가
맞기 때문이다. 모두 trim 0–1.2~1.6s, −3dB, 재생 시 0.96–1.05 피치 랜덤.

| 큐 | 원본 클립 | 들어 있는 번들 | 조건 (`audio.js:518-525`) | 해당 무기 |
|---|---|---|---|---|
| `fire_pistol` | `grach_fire_indoor_close` | `grach.bundle` | `cat === 'pistol'` | PM, PB, TT-33 |
| `fire_shotgun` | `mr133_fire_indoor_close` | `mr133.bundle` | `cal`이 `12`로 시작 | MP-133, MP-153, Saiga-12K |
| `fire_smg` | `stm9_fire_indoor_close` | **`m4a1.bundle`** | `cal`이 `9x`로 시작 | PP-91 Kedr, Kedr-B |
| `fire_rifle` | `sks_fire_indoor_close` | `sks.bundle` | 나머지 | AK-74N, AKM, AKS-74U, VPO-136 |

분기 순서가 중요하다 — `cat === 'pistol'`이 먼저라서 9x18 마카로프는 `fire_smg`가
아니라 `fire_pistol`로 간다. 무기 12정 전부 의도한 큐로 떨어진다.

대체가 정확하지는 않다. `fire_rifle`은 SKS(7.62x39) 소리를 AK-74N(5.45x39)에도
쓰고, `fire_smg`는 AR 플랫폼 9mm 카빈(STM-9) 소리를 PP-91 케드르에 쓴다.
구경별 개별 매칭이 아니라 **부류당 하나**를 고른 결과다.

`snd` 필드를 쓰지 않는 게 맞다. 무기 템플릿의 `snd`는 Saiga·MP-153·Kedr·AK를
전부 `weap_ar` 하나로 뭉뚱그리므로 `cal` 기반 분기보다 오히려 거칠다.

접두사 검사라 데이터가 늘면 깨질 자리가 둘 있다 — `startsWith('9x')`는 `9x39`
(VSS/AS Val 소총탄)도 잡아 저격소총에 SMG 소리를 내고, `startsWith('12')`는
`12.7x55`(ASh-12)를 산탄총으로 분류한다. 현재 DB에는 둘 다 없다.

**적의 사격은 아예 소리가 없다.** `sfx.fire`는 `raid.js:523`의 `playerFire()`
한 곳에서만 호출된다. AI는 `ai.js:132`에서 `registerShot({hostile:true})`만 부르고
그건 0.12초짜리 예광탄 기록을 배열에 넣을 뿐이며(`raid.js:462`), `ai.js`는 `sfx`를
import조차 하지 않는다.

---

## 재생되지 않는 큐 54개

팩에 오디오가 들어 있지만 현재 빌드에서 도달할 수 없는 큐다. 178개 중 **124개가
실제로 울린다.**

| 이유 | 개수 | 큐 |
|---|---|---|
| **스캐브 스폰이 0** | 5 | `fire_pistol`, `fire_rifle`, `fire_shotgun`, `fire_smg`, `death` |
| `sfx.use()`가 meds/food/drink 전용 | 33 | `item_keys_use`, `item_weap_ar_use`, `item_gear_armor_use` 등 |
| 해당 `ItemSound`를 쓰는 아이템이 없음 | 16 | `weap_dmr`, `weap_rifle`, `bigknife`, `magazine_drum`, `magazine_belt`, `ammo_launcher`, `container_pouch`, `spec_weaprep` 계열 |

**총성과 사망음은 지금 들을 수 없다.** `raid.js:94`의 `spawnScavs(count = 0)`이
적을 하나도 만들지 않고, `firing`은 `raid.scavAt()`이 적을 반환할 때만 켜지므로
(`raid-ui.js:205-208`) 빈 바닥을 클릭하면 이동 명령이지 발사가 아니다. 사망도
스캐브 사격이 유일한 피해원이라 마찬가지다. 주석대로 `count`를 7로 되돌리면
5개 전부 살아난다.

`_use` 큐 43개 중 실제로 울릴 수 있는 건 10개뿐이다 — `raid-ui.js:423`의 USE 메뉴가
`tpl.res && cat이 meds/food/drink`인 아이템에만 붙기 때문이다. 나머지 33개는
번들에는 있지만 게임에 발동 경로가 없다.

---

## 확인된 함정과 비대칭

- **`assets/sfx-eft/`에 매니페스트가 참조하지 않는 ogg 36개가 남아 있다.** 카테고리
  기반이던 옛 명명(`item_med_pickup`, `use_pills` 등)의 잔재로, 매니페스트가 로딩을
  결정하므로 재생되지는 않는다. 다만 `pack_sfx.py` 재실행 시 혼동 소지가 있다.
- **Alt+클릭 퀵 장착(`dnd.js:85-90`)은 무음이다.** 드래그 착용(`:286`)만 `ui_equip`을
  낸다. 같은 `moveToSlot`을 쓰는데 소리가 갈린다.
- **`closeAllContainerWindows`는 무음이다.** 레이드 진입/종료 시 컨테이너 창이
  한꺼번에 닫히는데 `ui_close`가 나지 않는다. X 버튼(`window.js:75`)만 소리를 낸다.
- **`ui_error`의 400ms 레이트 리밋이 이중 호출을 가린다.** 예를 들어 `trade.js:585`는
  직접 `ui_error`를 부르고 `toast(..., 'bad')`가 `shell.js:38`에서 또 부르는데,
  실제로는 한 번만 들린다.
- **`ui_inspect_open` / `ui_inspect_close`는 아이템 검사 전용이 아니다.** 모달
  전체(SPLIT 창, DISCARD 확인, WIPE PROFILE, PROFILE 창)가 같은 두 큐를 공유한다.
- **`container_metal_open`만 36,393Hz다.** 나머지 원본 클립은 44.1kHz. 원본 자체가
  그렇고, 어차피 추출 시 전부 32kHz로 리샘플된다.
- **발소리와 총성은 레이트 리밋을 우회한다.** `play(cue, { ..., limit: 0 })`에서 `0`은
  falsy라 `audio.js:362`의 `if (mix.limit && ...)` 검사가 통째로 건너뛰어진다.
  발소리는 `STEP_MIX`의 `gap`이 따로 막아 주지만, 총성은 아무 상한이 없다 —
  900 RPM 케드르는 초당 15개의 보이스를 캡 없이 쌓는다.
- **`open_plastic`이 재질 논리를 깬다.** 나무 궤짝은 `open_plastic`(플라스틱 뚜껑)으로
  열리고 곧바로 `search_wood`(나무 뒤적임)로 넘어간다. 시체도 마찬가지로 뚜껑 소리가
  먼저 난다. 원본 팩에 `open_wood`가 없어서 클립을 더 뽑기 전에는 고칠 수 없다.
  다만 `medbag`은 천 가방인데 `open_plastic`을 받는 반면 같은 그룹의
  `sportbag`/`duffle`은 `open_pouch`를 받는다 — 이건 `audio.js:499` 조건에 단어 하나
  추가하면 정합해진다.

---

## 재현

```bash
python tools/extract_tarkov_sfx.py --index                # 32,815 클립 카탈로그
python tools/extract_tarkov_sfx.py --search looting       # 이름으로 검색
python tools/extract_tarkov_sfx.py --extract              # assets/sfx-eft/*.ogg
python tools/pack_sfx.py                                  # pack.bin 봉인
```

인덱스는 `tools/cache/tarkov_sfx_index.json`(gitignore)에 남고, 추출본도
`assets/sfx-eft/`(gitignore)에 남는다. 저장소가 추적하는 건 봉인된 `pack.bin`뿐이다.
