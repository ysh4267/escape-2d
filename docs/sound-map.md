# 사운드 매핑 대조표

원본 Escape From Tarkov 설치본(`E:\Program Files\EFT`)의 어떤 오디오가 이 게임의
어떤 큐를 받치고, 그 큐가 어느 코드 줄에서 울리는지를 전부 대조한 표다.

**파일명 추측이 아니다.** 세 지점에서 확정했다.

1. **클립 이름은 유니티 에셋 이름이다.** `tools/extract_tarkov_sfx.py`의 인덱서는
   UnityPy로 번들을 열어 `AudioClip` 오브젝트의 `m_Name` 필드를 읽는다
   (`extract_tarkov_sfx.py:97-114`). 디스크의 파일명이 아니라 BSG가 에셋에 붙인
   내부 식별자다. 인덱스에 32,815개가 들어 있다.
2. **`sfx_picks.py`가 참조하는 클립 302건 전부가 그 인덱스에 존재한다.** 미해결 0건,
   매니페스트 누락 0건, 매니페스트에만 있고 픽에 없는 큐 0건, 고아 ogg 0건.
3. **아이템 효과음은 BSG의 `ItemSound` 필드를 그대로 쓴다.** `build_items.py:300-301`이
   SPT 3.10.1 `items.json`의 `_props.ItemSound`를 `snd`로 복사하고, 게임은
   `item_<snd>_<action>` 이름의 큐를 요청한다. 그 이름이 `itemsounds.bundle` 안의
   실제 클립 이름과 일치한다 — **원본 게임이 쓰는 식별자로 원본 클립을 부른다.**

현재 **170개 큐 / 347개 파일**. `tools/sfx_test.html` 55개 검사 전부 통과,
`tools/smoke.html` 125개 통과.

---

## 파이프라인

```
EFT 설치본                     추출/가공                  런타임
─────────────────────────      ───────────────────        ─────────────────────
sounds.bundle          ┐                                  manifest[cue] = [파일]
itemsounds.bundle      │   --index  AudioClip.m_Name              │
resources.assets       ├─► --search 이름 검색        ─────► play(cue) ─► 3버스
<무기>.bundle 11종      │   sfx_picks.py  큐 ← 클립               (sfx/ui/ambient)
sharedassets8/397/537  ┘   --extract ffmpeg 트림/믹스/모노/ogg
                            pack_sfx.py  deflate + AES-256-GCM
```

추출 공정(`extract_tarkov_sfx.py:184-224`)은 모든 클립에 동일하게 적용된다 —
모노 다운믹스, 앞뒤 -50dB 무음 제거, 32kHz(앰비언스만 22.05kHz), libvorbis q2.

`pack.bin`은 `SFX_PACK_KEY` 환경변수로 봉인한다. **키를 주지 않으면 새 패스프레이즈를
만들어 버려서 `audio.js`의 `SEALED_KEY`와 어긋난다.** 재패킹은 반드시:

```bash
SFX_PACK_KEY='aAzve0EY1zPMn9Z28Z-1rzq3hX_bh36z' python tools/pack_sfx.py
```

---

## 컨테이너별 출처

| EFT 컨테이너 | 담당 |
|---|---|
| `itemsounds.bundle` | 아이템 폴리 90큐 + 루팅 루프 10종 |
| `sharedassets397.assets` | 탄착·도탄 7큐 |
| `sounds.bundle` | 발소리 16큐 = 재질 4 × 보행 4 (102클립) |
| `resources.assets` | 인터페이스·거래 16큐 |
| `sharedassets8.assets` | 가구 뚜껑 8큐 |
| 무기 뱅크 11종 | 총성 22큐 |
| `sharedassets537.assets` | Factory 앰비언스 |

---

## 이동 — `sounds.bundle`

**재질축과 보행축은 서로 독립이다.** 예전엔 아니었다 — `step_sprint`만
`sprint_metal`을 써서, 콘크리트 바닥에서 뛰기 시작하면 발밑 재질이 철골로 바뀌었다.
큐 이름은 `step_<재질>_<보행>`이고 재질 4종 × 보행 4단계 = 16큐다.

| 재질 | walk | run | sprint | stop | 쓰는 구역 |
|---|---|---|---|---|---|
| `concrete` | `walk_concrete1–6` | `run_concrete1–6` | *asphalt 대체* | *asphalt 대체* | 공장 내부 전반, 구역 밖 기본값 |
| `metal` | `walk_metal1–6` | `run_metal1–6` | `sprint_metal1–6` | `stop_metal1–3` | 사일로 피트, 1번 게이트 적재장 |
| `tile` | `walk_tile_01–06` | `run_tile_01–06` | `sprint_tile_01–06` | `stop_tile_01–03` | 사무동, 서편 정비실 |
| `asphalt` | `walk_asphalt_01–06` | `run_asphalt_01–06` | `sprint_asphalt_01–06` | `stop_asphalt_01–03` | 동편 야드, 서편 안뜰 |

> **설치본에 `sprint_concrete`와 `stop_concrete`가 아예 없다.** 콘크리트는 walk·run·
> turn·jump만 있다. 그래서 그 두 칸만 asphalt로 메웠다 — 둘 다 단단한 무기질 표면이라
> 예전에 쓰던 철골 그레이팅보다 훨씬 작은 거짓말이다. 나머지 재질은 전부 자기 것을 쓴다.

**클립 명명이 재질마다 다르다.** `concrete`와 두꺼운 `metal`은 한 자리 숫자를 그냥
붙이고(`walk_concrete1`), 나머지는 언더스코어 뒤에 0을 채운다(`walk_asphalt_01`).
유추하지 말고 `--search`로 확인할 것.

폴백은 **재질축으로만** 한다(`audio.js`). 없는 세트가 있으면 재질이 콘크리트로 바뀔
뿐, 스프린트가 걷기로 떨어지지는 않는다.

| 보행 | 최소 간격 | 게인 | 피치 랜덤 | 조건 |
|---|---|---|---|---|
| walk | 430ms | 0.50 | 0.94–1.07 | 장비 총중량 **35kg 초과** |
| run | 330ms | 0.55 | 0.97–1.09 | 35kg 이하 — **기본 보행이 조깅** |
| sprint | 265ms | 0.62 | 1.00–1.12 | 스프린트 중 |

`gear_stereo`는 원본에서 이동하는 플레이어의 장비가 흔들리는 소리다. 게임이 발자국
위에 겹쳐 재생하는 레이어를 추출 단계에서 미리 믹스해 굽는다. `stop`만 예외로 맨
클립이다.

### 재질 판정

`maps.js`의 각 구역에 `surface`가 붙어 있고 `raid.surfaceAt(x, y)`가 읽는다.
구역 사각형은 일부러 겹친다 — 사일로 피트가 처리동 안에 들어 있다 — 그래서
**해당 좌표를 덮는 가장 작은 사각형이 이긴다.** 어느 구역에도 안 들어가는 복도·틈은
콘크리트다.

> 스폰 지점 이름과 실제 재질이 어긋나는 곳이 셋 있다 — "West service rooms"(14, 62)는
> 서편 안뜰 사각형에 1유닛 걸쳐 asphalt, "East wall room"은 동편 야드라 asphalt,
> "East main hall"은 사무동 사각형 안이라 tile이 난다. 판정은 사각형대로 정확히
> 동작하는 것이고, 구역 사각형이 대략적이라 생기는 일이다.

> `step_<재질>_stop`은 실제로는 "빈 바닥을 클릭해 목적지에 도착" 한 경우에만 들린다.
> 컨테이너 앞 도착은 같은 프레임에 오버레이가 열려 `!overlayOpen` 가드에 막힌다.

---

## 컨테이너 수색 — `itemsounds.bundle`

원본의 루팅 루프 10종을 전부 쓴다. 컨테이너 23종이 **빠짐없이** 매핑되며 폴백으로
떨어지는 타입은 없다.

| 큐 | 원본 클립 | 원본 → trim | 컨테이너 |
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

**이 큐들만 재생 방식이 다르다.** 단발이 아니라 루프 소스를 열어 둔다
(`audio.js:445-478`). 80ms 페이드인, 종료 시 120ms 페이드아웃. 아이템이 하나씩 나올
때마다 다시 울리지 않는다 — 원본도 그렇고, 4~6초 클립을 초당 재트리거하면 같은 소리가
네 겹으로 쌓인다. **아이템 발견 효과음은 의도적으로 없다** (원본에 없음).

### 뚜껑 여는 소리 — `sharedassets8.assets`

원래는 `itemsounds.bundle`의 `container_*_open` 4종을 썼다. 그건 **손에 든 아이템
케이스**가 내는 소리이고, 레이드에 놓인 가구는 자기 소리를 따로 갖고 있다. 이제
그쪽을 쓰므로 수색 루프와 재질이 맞는다 — 코트처럼 뒤적이는 것은 코트처럼 열린다.

| 큐 | 원본 클립 | 길이 | 컨테이너 |
|---|---|---|---|
| `open_wood` | `woodbox_open`, `woodbox_small_open` | 0.70 / 0.49s | crate, ammobox, weaponbox, weaponbox6, grenadebox, rationcrate |
| `open_case` | `plasticcase_heavy_open` | 0.49s | toolbox, suitcase, medcase, medcrate, pcblock, techcrate |
| `open_metal` | `safe_open` | 0.81s | safe, banksafe |
| `open_drawer` | `drawer_metal_open`, `drawer_metal_squeek_1` | 0.44s | drawer |
| `open_locker` | `door_metallocker_open` | 0.76s | filecab |
| `open_jacket` | `jacket_open` | 0.87s | jacket |
| `open_bag` | `sportbag_open` | 1.41s | sportbag, duffle, medbag |
| `open_cash` | `cashregister_open` | 1.50s | cashreg |

**시체는 뚜껑 소리가 없다.** `deadscav`/`pmcbody`는 `OPEN_CUE`에 일부러 넣지 않았고
`sfx.openContainer()`는 테이블에 없는 타입이면 그냥 return한다. 이전 빌드는 시신을
열 때 플라스틱 케이스 뚜껑 소리를 냈다.

`raid.js:289`의 호출은 `if (container.searched) return`보다 **앞**이라, 이미 다 턴
컨테이너를 다시 열어도 뚜껑 소리는 난다.

---

## 총성 — 무기별 뱅크 11종

**무기 12정이 각자 자기 녹음을 쓴다.** 이전에는 `fire_pistol`/`rifle`/`shotgun`/`smg`
4종을 구경으로 갈라 썼다.

설치본은 녹음 시기에 따라 총성 이름을 **세 가지 방식**으로 짓고, 어느 것도 무기
이름에서 유추할 수 없다:

```
ak74_indoor_close_01      신형 뱅크, 번호 변형 8개
akm_close_indoor_01       같은 시기인데 close/indoor 순서가 반대
tt_fire_indoor_close      구형 뱅크, 변형 1~2개, 이름에 "fire"가 들어감
```

전부 실내(`indoor`) 변형이다. Factory가 지붕 덮인 공장이라 반사가 맞는다.

| 큐 | 원본 클립 | 변형 | 번들 | 무기 |
|---|---|---|---|---|
| `fire_ak74` | `ak74_indoor_close_01`–`08` | 8 | `ak74.bundle` | AK-74N |
| `fire_aksu` | `aksu_indoor_close_01`–`08` | 8 | `aksu.bundle` | AKS-74U |
| `fire_akm` | `akm_close_indoor_01`–`08` | 8 | `akm.bundle` | AKM, VPO-136 |
| `fire_kedr` | `kedr_indoor_close_01`–`08` | 8 | `kedr.bundle` | PP-91 Kedr |
| `fire_kedrb` | `kedr_indoor_close_silenced_01`–`08` | 8 | `kedr.bundle` | PP-91-01 Kedr-B (**소음형**) |
| `fire_pm` | `pm_indoor_close1`–`2` | 2 | `pm.bundle` | Makarov PM |
| `fire_pb` | `pb_silenced_indoor_close1` | 1 | `pb.bundle` | PB (**소음형**) |
| `fire_tt` | `tt_fire_indoor_close`, `2` | 2 | `tt.bundle` | TT-33 |
| `fire_mp133` | `mr133_fire_indoor_close` | 1 | `mr133.bundle` | MP-133 |
| `fire_mp153` | `mr153_fire_indoor_close` | 1 | `mr153.bundle` | MP-153 |
| `fire_saiga` | `saiga_indoor_close1` | 1 | `saiga12.bundle` | Saiga-12K |

VPO-136만 자기 뱅크가 없다. AKM 계열 7.62x39 카빈이라 AKM 뱅크를 쓰는 **유일한
의도적 재사용**이다.

Kedr-B와 PB는 소음형이라 원본의 `_silenced` 뱅크를 쓴다 — 게임 안에서도 조용하다.

### 적의 사격 — `fire_<뱅크>_far`

**이전에는 적이 쏴도 아무 소리가 나지 않았다.** `ai.js`가 `sfx`를 import조차 하지
않았고 `registerShot`은 예광탄 기록만 남겼다.

이제 같은 뱅크의 `_distant` 변형을 −7dB로 재생한다(`ai.js:shoot`). 스캐브는 스폰 시
티어별 후보에서 뱅크를 하나 뽑아 두므로 같은 개체는 계속 같은 총을 쓴다:

| 티어 | 후보 |
|---|---|
| 1 | mp133, akm, kedr |
| 2 | akm, aksu, kedr, mp153 |
| 3+ | ak74, aksu, akm, saiga |

---

## 탄착 — `sharedassets397.assets`

명중 판정을 소리로 갈랐다. 이전에는 총성 외에 아무 피드백도 없었다.

| 큐 | 원본 클립 | 변형 | 언제 |
|---|---|---|---|
| `hit_body` | `body1`–`6` | 6 | 살에 맞음 |
| `hit_armor` | `bodyarmor1`–`4_close` | 4 | 방탄복이 막음 |
| `hit_helmet` | `impact_helmet_ric_3p_1`–`4` | 4 | 헬멧이 튕겨냄 |
| `impact_metal` | `metal1`–`6` | 6 | 빗나가 금속에 |
| `impact_wood` | `wood1`–`5` | 5 | 빗나가 나무에 |
| `impact_concrete` | `generic_hard1`–`3` | 3 | 빗나가 콘크리트에 |
| `ricochet` | `ricochet1`–`13` | 12 | 도탄 (`ricochet8`은 원본에 없음) |

`damagePlayer()`가 방탄복 흡수·헬멧 도탄 분기에서 무엇이 막았는지 기록해
해당 큐를 낸다. 플레이어는 막힌 탄과 관통을 소리로 구분할 수 있다.

---

## 아이템 취급 — `itemsounds.bundle`

큐 이름을 런타임에 조립한다: `item_<snd>_<pickup|drop|use>`.

**클래스 목록을 하드코딩하지 않고 `items-db.json`에서 파생한다.** 이전 픽 파일은
48개 클래스와 전체 `_use` 세트를 갖고 있었는데, 아이템이 실제로 쓰는 건 40종이고
`_use`는 10종만 발동 가능했다 — **팩에 실려 나가지만 절대 재생될 수 없는 큐가
57개** 있었다. 이제 pickup 40 + drop 40 + use 10 + generic 폴백 3 = 90큐다.

`_use`는 `raid-ui.js`의 USE 메뉴 조건(`tpl.res` && cat이 meds/food/drink)을 그대로
반영한다. 원본 번들에 `_use` 클립이 없는 5종(grenade, item_money, jewelry,
smallmetal, spec_multitool)은 `_NO_USE`로 제외되고 `_pickup`으로 대체된다.

아이템을 추가하고 `--extract`를 다시 돌리면 그 소리가 자동으로 들어온다. 팩이
데이터베이스와 어긋날 수 없다.

---

## 인터페이스 · 거래 · 결과 — `resources.assets`

| 큐 | 원본 클립 | 버스/게인 | 트리거 |
|---|---|---|---|
| `ui_click` | `button_click` | ui 0.45 | `.btn`/`.seg`/`.map-card` 클릭, 은신처 탭, 컨텍스트 메뉴 항목, 드래그 중 회전 |
| `ui_hover` | `button_over` | ui 0.22, 60ms | 위 요소 진입 |
| `ui_context` | `menu_context_menu` | ui 0.40 | 우클릭 메뉴가 실제로 뜰 때 |
| `ui_error` | `error_message` | ui 0.50, 400ms | `toast()`가 `warn`/`bad`일 때 + 거래 거부 6곳 |
| `ui_close` | `menu_escape` | ui 0.35 | 컨테이너 창 X, 레이드 오버레이 닫힘 |
| `ui_window_open` | `menu_open_container` | ui 0.45 | 레이드 오버레이 열림 |
| `ui_inspect_open` | `menu_inspector_window_open` | ui 0.40 | 모달 열림 전부 |
| `ui_inspect_close` | `menu_inspector_window_close` | ui 0.40 | 모달 닫힘 전부 |
| `ui_equip` | `clothes_equip` | **sfx** 0.55 | 드래그로 장비 착용 성공 |
| `ui_exp` | `notification_exp` | ui 0.40, 900ms | 레벨이 실제로 오름 |
| `trade_tab` | `menu_trader_press` | ui 0.45 | 다른 상인으로 전환 |
| `trade_click` | `trade_click_button` | ui 0.45 | 오퍼 스테이징, 세그먼트 전환, CLEAR, 수량 조작 |
| `trade_buy` | `buy_button_click` | ui 0.50 | Fill items |
| `trade_deal` | `trade_operation_complete` | ui 0.60 | 구매 커밋 성공, 판매 DEAL! 진입 |
| `extract_done` | `quest_completed` | ui 0.65 | 탈출 6초 홀드 완주 |
| `death` | `fp_death_heartbeat` | sfx 0.70 | `finish(KIA)` — MIA/LEFT는 무음 |
| `amb_factory` | `amb_factory_rework_day_loop` | ambient | 레이드 진입 2.5s 페이드인 / 종료 0.8s 페이드아웃 |

`ui_equip`만 ui 버스가 아니라 sfx 버스다 — 인터페이스 소리가 아니라 착용 폴리로
취급한다. 탈출음은 원본의 탈출 큐가 아니라 **퀘스트 완료음**이다.

---

## 남은 문제

- **거래 화면 일부 버튼은 소리가 두 번 난다.** `shell.js:76`의 문서 전역 클릭
  핸들러가 `.btn`/`.seg`를 잡는데, 자기 큐를 내는 컨트롤 중 `data-sfx`가 붙은 건
  DEAL! 버튼 둘뿐이다. BUY/SELL 세그먼트와 Fill items 버튼은 `ui_click`과
  `trade_*`가 겹친다. **`trade.js`가 현재 편집 중이라 손대지 않았다** — 해당
  요소에 `dataset: { sfx: 'own' }`을 붙이면 해결된다.
- **총성·탄착·사망음은 아직 들을 수 없다.** `raid.js:94`의 `spawnScavs(count = 0)`이
  적을 만들지 않아서다(의도된 설정). `count`를 7로 되돌리면 전부 살아난다 — 배선은
  끝나 있고 `sfx_test.html`이 실제 입력으로 호출해 검증한다.
- `ui_error`의 400ms 리밋이 이중 호출을 가린다. `trade.js`가 직접 부르고 `toast()`가
  또 불러도 한 번만 들린다.
- `ui_inspect_open`/`_close`는 아이템 검사 전용이 아니다. 모달 전체가 공유한다.
- Alt+클릭 퀵 장착은 무음이다. 드래그 착용만 `ui_equip`을 낸다.

---

## 재현

```bash
python tools/extract_tarkov_sfx.py --index      # 32,815 클립 카탈로그
python tools/extract_tarkov_sfx.py --search ak74  # 이름으로 검색
python tools/extract_tarkov_sfx.py --extract    # assets/sfx-eft/*.ogg
SFX_PACK_KEY='aAzve0EY1zPMn9Z28Z-1rzq3hX_bh36z' python tools/pack_sfx.py
```

인덱스(`tools/cache/`)와 추출본(`assets/sfx-eft/`)은 둘 다 gitignore다. 저장소가
추적하는 건 봉인된 `pack.bin`뿐이다. 원본 오디오는 Battlestate Games의 저작물이며,
소유한 사본에서 로컬로 쓰는 것과 재배포는 다른 문제다.
