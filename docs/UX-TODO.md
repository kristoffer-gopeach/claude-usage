# UX- och produkttodo

Härledd ur genomgången 2026-09-04 av commit `2e82a0b`. Ordnad efter implementationsordning, inte efter prioritet, så att beroenden faller rätt. Radnummer gäller `ClaudeUsageExpo/src/features/dashboard/UsageDashboard.tsx` om inget annat anges.

Prioritet: **P0** tydligt problem, **P1** stor UX-förbättring, **P2** bra men inte kritisk, **P3** experiment.

## Status 2026-09-04

**Klart och verifierat:** Steg 0 i sin helhet, samt F1, F2, F4a, F5, F6, F8, F9 ur Steg 1 och R1 till R5 ur Steg 1b.

Verifiering: `npm run typecheck` och `npm run lint` rena. 14 enhetstester på snapshot-serialiseringen gröna. Utloggat läge på 375 x 667 mäter `scrollHeight === clientHeight === 667`, alltså inget scrollbehov, mot 646 av 647 punkter före. Maxbredden slår in vid 900 px. Mörkt läge kontrollerat. iOS-bundlen bygger, 1 315 moduler.

**Kvar som kräver fysisk enhet:** testa Större text på max, Codex-panelen i landskap, och att tangentbordet inte täcker inloggningsfältet i landskap.

**Kvar som är ert beslut:** R6, alltså om `supportsTablet` ska bli `true`.

**Även klart:** F11 i huvudsak, plus F4b, S1 och S12 som var blockerade på att menyn fanns. Titeln i gränsraderna ligger nu ovanför procenten i liggande läge, så långa namn som `Claude Sonnet 4.5` slutar klippas till `V…`.

**Även klart:** F19a, hämtningsindikatorn.

**Även klart:** F17 temavalet, F18 Halloween, F20a alla modellgränser, F10 historik med förbrukningstakt, F19b kvotpulsen och F19c aktivitetsremsan, samtliga verifierade i båda vyerna och för båda tjänsterna.

**Paritet mellan vyerna, 2026-09-04.** Stödraden på primärkortet visas nu även i liggande läge, alltså `Takten räcker till återställningen` och de andra tre varianterna. Primärpanelen hade bara omkring 17 punkters marginal, så metriken krymper från 104 till 78 px när en stödrad finns. Uppmätt: noten bottnar på 326 av 381 punkter, inget trunkerat.

**Två buggar hittade på enhet och rättade 2026-09-04:**
1. Hydreringen markerade cachad data som `stale`, vilket gav en röd `Kunde inte uppdatera`-varning vid varje kallstart. Att läsa cache är inget misslyckande. `stale` betyder nu bara att ett anrop faktiskt har misslyckats, och åldern i färskhetsraden är den ärliga signalen.
2. När WebViewen inte var redo returnerade `refreshProvider` tomt om användaren inte stod i inloggningsvyn. Readiness sätts bara från `onLoadEnd`, så en tryckning på försök igen kunde aldrig leda någonstans och appen väntade tyst för alltid. Nu laddas WebViewen om, dock aldrig medan inloggningssidan visas, och en 15-sekundersgräns ger ett begripligt fel i stället för tystnad.

**Inte påbörjat:** Steg 3, och F3, F7 och F12 ur Steg 2. F3 är den största posten kvar.

Sidoeffekt av Steg 0: `components/`, `hooks/` och `constants/` raderades, 13 filer död Expo-mallkod som `app/` och `src/` aldrig importerade och som var enda källan till alla sex typfel. Finns i git på `2e82a0b`.

---

## Beslut · Formuleringar och sparade visningsval
**2026-09-04**

**`Arbetar…` blev `Förbrukat`.** Etiketten hette först `Förbrukas nu`, byttes på begäran till `Arbetar…`, och landade slutligen på `Förbrukat · 0,5 % senaste minuten`. Sista formen är den riktiga, för det är vad datan bär: kvoten har förbrukats. `Arbetar…` antydde att **användaren** arbetar, vilket appen inte kan veta. Ökningen kan komma från en annan enhet, en annan session eller ett bortglömt skript. Tidsspannet i strängen bär redan nu-känslan, så inget extra ord behövs.

**`Tänker…` går inte att bygga.** Usage-ändpunkten rapporterar förbrukad kvot, inte vad modellen gör. Det finns inget fält som skiljer tänkande från generering. Att lägga till det vore att hitta på en skillnad datan inte kan göra, alltså samma invändning som mot F14.

**Återställningsformatet sparas, per rad.** Ett tryck på en återställningstid växlar mellan klockslag och återstående tid, och valet ligger kvar. Första versionen gjorde det globalt, så ett tryck ändrade alla rader samtidigt, vilket var fel. Nu nycklas det på **fönstret** och inte på renderingsplatsen, så samma gräns läses likadant i stående och liggande medan olika gränser kan ha olika format. Sparas under `usage-monitor.reset-format.v1`. Ett värde från den tidigare enkelstrukturen ignoreras i stället för att krascha på `JSON.parse`.

Bieffekt: `ResetLabel` blev enklare. Den hade egen timer som återgick efter sex sekunder, vilket gjorde att samma skärm kunde visa båda formaten samtidigt. Nu är den en ren kontrollerad komponent utan effekter.

## Öppet beslut · Räknar appen fel håll?
**Ställd fråga, inget svar än**

Codex egna gränssnitt visar `Återstående användning`, alltså 99 % och 37 % kvar. Appen visar 1 % och 63 % **använt**. Samma tal, motsatt riktning, och kontrollen stämmer: 100 − 63 = 37.

Värt att veta för beslutet: **båda API:erna rapporterar använt**, Claude i fältet `utilization` och Codex i `used_percent`. Appen är alltså trogen datakällan, medan Codex gränssnitt räknar om. Att jämföra de två vyerna kräver därför huvudräkning, vilket ledde till att veckoprocenten uppfattades som fel tre gånger.

Delfix redan gjord: porträttraderna sa bara `63%` utan riktning, medan liggande sa `använt`. Nu säger båda `använt`.

Kvar att avgöra: om huvudsiffran ska räkna ner i stället, om den ska förbli använt, eller om det ska bli ett sparat val i menyn som återställningsformatet.

---

## Besvarat med råsvaret från OpenAI · båda öppna frågorna
**2026-09-04, tillfällig diagnostik i `parseCodexUsagePayload`, sedan borttagen**

```
primary_window   { used_percent: 1,  limit_window_seconds: 18000  }
secondary_window { used_percent: 63, limit_window_seconds: 604800 }
```

**Fråga 1: visade Codex Claudes veckoprocent?** Nej. 63 procent kommer från OpenAI:s eget `secondary_window`. Deklarerad varaktighet är 604800 sekunder, alltså exakt sju dygn, och 18000 för primärfönstret, alltså exakt fem timmar. `mapCodexWindowsByDuration` mappade båda rätt. Jag granskade dessutom varje läsning av per-tjänst-data i `UsageDashboard`: samtliga går via `[activeProvider]` och alla tre härledningarna kommer ur `snapshots[activeProvider]`. Det finns ingen väg för data att korsa mellan tjänster.

**Fråga 2: returnerar ändpunkten bråkdelar?** Nej. `used_percent` kom som hela heltal, 1 och 63, utan decimaldel. Det sätter golvet för allt som mäter förändring mellan två avläsningar.

Konsekvens för **F19b, kvotpulsen**: minsta observerbara steg för Codex är en hel procentenhet. Tröskeln på 0,1 procent är därmed meningslös där, och pulsen tänds bara vid ganska tung förbrukning inom tremminutersfönstret. Funktionen är inte trasig, men förväntan ska vara att den syns sällan på Codex. Om Claude returnerar bråkdelar är fortfarande okänt.

Observationen är skriven som kommentar i `usage.ts` så nästa läsare inte behöver gissa. Inga `console.`-anrop finns kvar i `src/`.

---

## Rättat · Takten hade lägre prioritet än den mjuka noten
**2026-09-04, upptäckt av produktägaren på Codex-fliken**

Kortet visade `Veckogräns 63 %` där `Slut kl. X` förväntades. Inte ett fel i Codex, utan i min prioritetsordning: noten har **en** rad, och regeln lät varje ledande gräns vinna över den uppmätta takten. Takten är den rad kortet förväntas bära, eftersom den handlar om just det fönster som visas.

Ny ordning, verifierad i tre kontrollerade fall:

| Läge | Visas | Varför |
|---|---|---|
| Veckogräns 96 %, takt finns | `Veckogräns 96 %` | Verkligt brådskande, får inte gömmas bakom något |
| Veckogräns 63 %, takt finns | `Slut kl. 16:10` | Takten vinner nu över den mjuka noten |
| Veckogräns 63 %, ingen takt | `Veckogräns 63 %` | Fallback när takten inte går att räkna ut |
| Inget av ovan, flera modellgränser | modellen med mest utrymme | Sista fallback |

Alltså: bara den genuina varningen vid 90 procent står över takten. Allt mjukare hamnar under den.

## Öppet · Två frågor som riktig data ännu inte besvarat

**Returnerar ändpunkten bråkdelar?** Kvotpulsen kräver minst 0,1 procents upplösning. Vid test gick värdet från 0 till 1 procent, men gränssnittet avrundar så råvärdet syns inte. Jag försökte läsa det via diagnostikdelningen, som formaterar med två decimaler, men iOS delningsblad visar bara rubriken och inte brödtexten. Frågan är alltså fortfarande obesvarad.

**Varför uteblev pulsen och aktivitetsremsan vid testet?** Båda kräver två mätningar nära varandra i tid. Under testet gjorde mina kodändringar upprepade Fast Refresh-omladdningar, och varje omladdning nollställer live-grinden. Glappet mellan de två senaste mätningarna översteg därför tremminutersfönstret. Det är den skärpta regeln som fungerar som avsett, inte ett fel, men det betyder att funktionerna först kan bedömas under en session utan omladdningar.

---

## Verifierat med riktig Codex-data · simulator, inloggad
**2026-09-04**

Första gången hela kedjan körts mot ett verkligt konto. Codex anslöts i simulatorn och usage hämtades: femtimmarsgränsen 0 procent, veckogränsen 63 procent, `Återställs kl. 20:29`, veckogränsen `Återställs 7 sep. kl. 11:00`. Statusprick grön, `Uppdaterad nyss`, menyn visar Codex som **Ansluten** med `Koppla bort` medan Claude står som `Inte ansluten` med `Logga in`.

**Två saker rättade, båda synliga först med riktig data.**

1. **Hjältesiffran stod ensam och sa 0 procent** medan veckogränsen låg på 63. Notikonen triggade bara vid 90 procent, så kortet visade skärmens minst informativa tal och pekade inte på det som betydde något. Regeln är utökad: noten visas nu också när ett annat fönster ligger minst 30 procentenheter högre än femtimmars **och** självt är över 35 procent. Båda villkoren måste vara uppfyllda, så en lugn vecka förblir tyst. Tonen blir `info` i det fallet och `warning` först vid 90, så allvarsgraden skiljer sig.

   Verifierat på enhet: kortet visar nu `Veckogräns 63 %` under klockslaget.

2. **Tooltipen täckte återställningsraden och stapeln.** Bubblan låg ovanför ikonen, alltså precis över den information man mest behöver medan man läser förklaringen. Flyttad under ikonen, som är kortets sista rad, så den nu bara lägger sig på bakgrunden. Den överlappar sektionsrubriken `Övriga gränser`, vilket är en etikett och inte data.

**Ännu inte synligt, korrekt.** Aktivitetsremsan, förbrukningstakten och kvotpulsen visas inte, eftersom de kräver historik och förbrukning. Med 0 procent använt och en tom logg är tomt rätt svar. De dyker upp när Codex faktiskt används, och **då kan den kvarvarande frågan i F19b äntligen besvaras**: om ändpunkten returnerar bråkdelar. Gör den inte det uteblir pulsen vid lätt användning.

---

## Verifierat på riktig iOS · iPhone 17e, iOS 26.5
**2026-09-04, efter att `sudo xcode-select -s` körts**

Det viktigaste resultatet i hela genomgången: **login-overlayn renderar korrekt i toppen på enhet.** Det var buggen sessionen började med, `StyleSheet.absoluteFillObject` borttagen i React Native 0.86, och den är nu bevisad fixad på riktig hårdvara och inte bara i webpreviewen.

| Kontroll | Resultat på enhet |
|---|---|
| Login-overlay, header i toppen | korrekt, `Avbryt / Logga in på Claude / Klar` |
| WebView laddar claude.ai | ja |
| Hamburgaren syns utloggad | ja, vilket var S1-fixen |
| Menyn: konton, tema, om appen | alla tre sektioner renderar |
| Bocken för valt tema | syns, tomma cirklar på övriga, alltså inte bara färg |
| Temabyte till Halloween | slår igenom direkt |
| Halloween-ambiens | spindelnät inne i hörnen efter fixen, fladdermus svävar, pumpa ersätter personikonen |
| Läsbarhet med ambiens | texten fullt läsbar |
| Flikbyte i Halloween | indikatorn glider, Codex får häxlila accent |
| Providerkorrekt innehåll | `Fortsätt med OpenAI` och `Anslut ditt OpenAI-konto` på Codex-fliken |

**Inte testat, och varför.** Jag loggade inte in på Claude eller Codex, och rörde inte cookie-bannern som claude.ai visar i WebViewen. Att skriva in kontouppgifter eller godkänna samtycken åt någon annan gör jag inte. Det steget är ditt, och det är också det enda som återstår för att bekräfta att usage faktiskt hämtas.

**Kunde inte testas i simulatorn.** Liggande monitorläge kräver hämtad data, och `simctl` kan inte rotera enheten. Liggande är därför verifierat genom mätning i webpreviewen och genom den härledda kurvan, inte på enhet.

**En kosmetisk observation, medvetet inte åtgärdad.** En pumpa på `top: 13%` ligger delvis bakom `Usage`-rubriken. Vid opacitet 0,2 mot benvit fet 36-punktstext är läsbarheten opåverkad, vilket skärmbilden visar. Att finjustera dekor mot den uttalade prioriteringen att funktion går före effekter vore fel avvägning.

---

## Rättat efter QA · Falsk aktivitetssignal och liggande responsivitet
**2026-09-04**

**"Arbetar…" när ingenting arbetade.** Verklig brist, hittad av produktägaren. Historiken persisteras, så vid en kallstart jämfördes två **lagrade** mätningar från förra sessionen utan att appen hämtat något nytt. Öppnade man appen inom sex minuter efter att ha jobbat stod det "Arbetar…" fast ingenting pågick.

Åtgärd i två delar:
- `computeRecentDelta` tar nu `requireSampleAt`. Påståendet måste vila på en mätning gjord **i den här sessionen**, spårad per tjänst i `liveSampleAt` som sätts i `recordSample`. Finns ingen live-mätning visas ingenting
- Fönstret skärpt från sex till tre minuter, eftersom sex var för generöst för ett påstående om "nu"

En logisk lucka i min egen första fix: `null` tolkades som "inget krav", alltså var grinden **av** vid kallstart, precis då buggen inträffade. Rättat så att `null` betyder att ingenting mätts och därför inget hävdas. Sju nya enhetstester täcker båda vägarna.

Verifierat: kallstart med stigande lagrad historik visar nu `Uppdaterad 1 min sedan` i stället för `Arbetar…`, och siffrorna visas fortfarande.

**Liggande läge var inte helt responsivt.** Monitorns typskala var fast, och den layouten måste rymmas i en enda skärmhöjd utan scroll. Räknat: vid höjd H får `monitorBody` H minus 80 punkter, och primärpanelen med stödrad behövde omkring 277. Vid 375 fanns 295, vid 320 fanns 240, alltså 37 punkter för lite.

En brytpunkt hade inte hjälpt, eftersom alla liggande telefoner hamnar i samma intervall. Måtten härleds nu ur `Math.min(width, height)`, med kurvan lagd så att kromet omkring hjältesiffran räknas som fast och siffran får en andel av det som återstår:

| Kort sida | Metrik | Med stödrad | Marginal |
|---|---|---|---|
| 320 | 78 | 66 | +5 |
| 375 | 104 | 88 | +20 |
| 415 | 104 | 88 | +34 |
| 440 | 104 | 88 | +73 |

Panelens padding härleds också, vilket köpte marginalen vid 320 utan att röra hjältesiffran vid 375. Uppmätt vid kort sida 415: formeln ger 88 px och komponenten rapporterar 88 px.

**Ambiensen låg utanför skärmen.** Spindelnätet på `top: 87%` plus en 40 px glyf hamnade fyra punkter under kanten i liggande. Procentpositioner måste ha plats för glyfens egen höjd. Flyttat till 80 procent.

**Ett fynd som inte var en defekt.** Mitt svep flaggade 17 element som "under kanten" när menyn var öppen i liggande. Menyns egen container är 314 punkter med 789 punkters innehåll och skrollar korrekt, alltså var svepet för naivt, inte appen trasig.

Slutkontroll efter allt: noll problem i porträtt vid exakt 375 x 667, noll i liggande, för båda tjänsterna, i både mörkt och Halloween.

---

## QA-genomgång 2026-09-04

Fem faser: verifiera, fixa, testa igen, förbättra, animera, sluttesta.

**Två defekter hittade och rättade.**

1. **Menyn var oåtkomlig i liggande monitorläge.** `LandscapeMonitor` har egen header utan hamburgare, så inställningar, konton, tema och diagnostik krävde att man vred tillbaka telefonen. Åtgärd: hamburgare i monitorns header, verifierad att den öppnar alla tema- och kontoval och att stängning återgår till monitorläget.
2. **Indikatorn i tjänsteväljaren blev för bred.** Min egen bugg, införd samma dag: `onLayout` rapporterar yttre bredd inklusive containerns padding, så en delning på två gav en indikator som gled förbi sitt spår. Åtgärd: padding räknas av före delningen. Uppmätt efteråt, indikator 164 mot flikbredd 163 i stående och 84 mot 84 i liggande, alltid inom spåret.

**Verifierat genom att faktiskt klicka, inte genom kodläsning:**

| Kontroll | Resultat |
|---|---|
| Flikbyte Claude ↔ Codex, state bevarat | ja, Claude-datan oförändrad efter återgång |
| Codex utan modellgränser | 0 modellrader, korrekt |
| Menyn: position, z-index, täckning | `absolute`, `zIndex: 20`, täcker skärmen |
| Temaväxling från menyn | `dark` → `halloween` persisterat, rubrik blir `Usage 🎃` |
| Temaväxling nådd från liggande | fungerar efter fixen |
| Koppla bort | stänger menyn, går till inloggningsläge, nollar lagrad snapshot |
| Tryckbara etiketter | eget tillstånd per rad, ingen påverkar de andra |
| Trunkering i något läge | ingen, i något tema, för någon tjänst |

Två saker som **ser** ut som defekter på web men inte är det: `aria-selected` och `aria-checked` saknas, vilket är en mappning react-native-web inte gör för de rollerna. `accessibilityState.selected` och `.checked` mappar till rätt traits på iOS. Och "Avbryt" och "Klar" saknar `aria-label` men får sina namn från sitt textinnehåll.

**Animationer, fas 5.** Ett rörelsesystem i `src/features/dashboard/motion.ts`, inte olika timing per komponent: 180 ms in, 130 ms ut, 220 ms för en kontroll som flyttar, 420 ms för ett värde som landar. Ease-out cubic genomgående.

Applicerat på fyra ställen där rörelse säger något:
- Tjänsteväljarens indikator glider i stället för att hoppa. Uppmätt kurva: `0 → 45 → 114 → 149 → 162 → 163 → 164`, alltså inbromsande
- Menyn tonar in och ut
- Notbubblan tonar in och ut
- `UsageBar`, alla fyra staplar, glider till nytt värde när data landar. Egen komponent i stället för fyra kopior

**Alla sex animerade filer har `useReducedMotion`**, verifierat med sökning. Ingen animation ändrar layout, så inga layout shifts.

**Inte testat, och varför.** `react-native-webview` och `expo-secure-store` fungerar inte på web, så de faktiska inloggningsflödena för Claude och Codex kan bara testas på enhet eller i simulator. Simulatorn kräver `sudo xcode-select -s`, som inte kan köras utan lösenord.

---

## Steg 0 — Process, gör detta först

Tar minuter och skyddar allt nedan. Overlay-buggen som gjorde inloggningen onåbar var `StyleSheet.absoluteFillObject`, borttagen i React Native 0.86. TypeScript flaggade den hela tiden. Inget körde typecheckern.

- [x] **P0-1** Lägg till `"typecheck": "tsc --noEmit"` i `ClaudeUsageExpo/package.json`
- [x] **P0-2** Rensa de sex kvarvarande `tsc`-felen så att grönt betyder grönt
  - `components/parallax-scroll-view.tsx:55`, `components/ui/icon-symbol.tsx:8,40`, `hooks/use-theme-color.ts:14,19`
  - Alla är samma sak: `ColorSchemeName` kan vara `'unspecified'` och används som indexnyckel
- [x] **P0-3** Kör `lint` och `typecheck` innan varje delning till testare

---

## Steg 1 — Gör nu

Sju ändringar, ingen rör arkitekturen. Kan göras i den här ordningen av en person.

### F2 · Låt gammal data överleva ett misslyckat anrop
**P0 · insats mycket låg · risk låg**

- [x] Ta bort `setSnapshots((current) => ({ ...current, codex: null }))` på rad 267
- [x] ~~Lägg till `staleSince: Date | null` per provider i state~~ Byggdes som `staleProviders: ProviderRecord<boolean>`, eftersom åldern redan finns i `snapshot.fetchedAt` och ett extra datum hade blivit en andra sanning
- [x] Nolla snapshot **endast** vid `CodexAuthRequiredError`, där datan verkligen inte längre gäller
- [x] Visa en rad ovanför siffrorna. Byggdes som `staleBanner`, tryckbar för att försöka igen, med felmeddelandet som text. Åldern står kvar i färskhetsraden i stället för att upprepas

Klart när: flygplansläge på och pull to refresh behåller siffrorna och visar en märkning, istället för att kasta tillbaka till inloggningspanelen.

> Kommentaren i koden säger att gammal data aldrig får visas. Avsikten är rätt, medlet är för hårt. Förtroendet skyddas av märkningen, inte av tomheten.

### F1 · Visa senast kända läge omedelbart vid start
**P0 · insats låg · risk låg · bygger på F2**

- [x] Utöka AsyncStorage-nyckeln `usage-monitor.connected-providers.v1` (rad 59) till att också bära senaste snapshot per provider, eller lägg en ny nyckel `...snapshots.v1`
- [x] Serialisera `Date`-fält som ISO och parsa tillbaka vid läsning, annars blir `resetsAt` en sträng och `formatReset` går sönder
- [x] Rendera cachat värde direkt vid montering, kör uppdateringen i bakgrunden
- [x] Märk med ålder via befintliga `formatRelativeTime`
- [x] Kasta cachen om den är äldre än sitt eget `resetsAt`, då är fönstret redan nollställt

Klart när: appen kan tvingas stängas och öppnas igen och visar siffror inom en bildruta, utan spinner.

### F5 · Synlig kontroll för att hålla skärmen tänd
**P1 · insats låg · risk låg · bäst nytta per rad i hela listan**

- [x] Lyft `useKeepAwake` från `LandscapeMonitor` till `UsageDashboard`
- [x] ~~Styr den med explicit state~~ **Omvärderat 2026-09-04:** växeln togs bort igen på Kristoffers begäran. Skärmen hålls tänd villkorslöst så länge vyn är monterad, vilket är hela poängen med appen. iOS släpper idle-timern när appen bakgrundas, så det gäller bara medan appen faktiskt är öppen
- [x] ~~Ikonknapp i färskhetsraden~~ Borttagen. En växel för något man alltid vill ha är bara ett extra beslut
- [x] ~~Kort rad när läget är på~~ Borttagen med växeln. Permanent hjälptext för ett permanent beteende är brus
- [x] Rotationen kvar som väg till stor-siffervyn

Klart när: skärmen inte släcks medan appen är öppen, utan att användaren behöver göra något.

> Logiken finns redan. Monitor-läget är den bäst designade delen av appen och samtidigt den svåraste att hitta.

### F6 · Nedräkning för det akuta fönstret
**P1 · insats låg · risk låg**

- [x] I `formatReset` (rad 1260): för `five-hour`, returnera `Återställs om 2 h 15 min` med klockslaget som sekundär text
- [x] Behåll datum och tid för `weekly`, där dagar är mindre användbart
- [x] Uppdatera på samma tick som den befintliga automatiska uppdateringen, ingen ny timer behövs
- [x] Hantera negativ differens, alltså ett `resetsAt` som redan passerat

Klart när: kortet svarar på "kan jag börja nu" utan att användaren räknar själv.

### F9 · Nära gränsen får inte signaleras med färg enbart
**P1 · insats mycket låg · risk ingen**

- [x] Lägg varningsikon före procentsatsen vid `>= 90` i `UsageLimitRow` (rad 1222)
- [x] Samma i `MonitorLimitRow` (rad 1144)
- [x] Komplettera VoiceOver-etiketten med `nära gränsen`

Klart när: gränsvarningen syns i gråskala och i starkt solljus.

> Rubrikens statusprick gör redan rätt, där följer text alltid färgen. Använd samma mönster.

### F8 · Tillgänglighet: kontrast, Dynamic Type, semantik
**P1 · insats låg till medel · risk låg**

Kontrast, mätt på faktiska hexvärden inklusive alfablandning. Kravet är 4,5:1 under 18 px.

- [x] `primaryValueSuffix` (rad 1412), mörkt läge: **3,96:1** Claude, **4,18:1** Codex
- [x] `remainingBadgeText` (rad 1409), ljust läge: **4,46:1**
- [x] `tertiary` (rad 154), ljust läge: **3,45:1** — höj `#888A91` till omkring `#6E7078`

De tre första har samma orsak: text färgad med `opacity` ovanpå en mättad accentfärg. Ersätt med egna dämpade färgtokens per tema istället för genomskinlighet.

Dynamic Type. Ingen hantering finns, noll träffar på `allowFontScaling`, `maxFontSizeMultiplier` och `PixelRatio.getFontScale` i hela `src/`.

- [x] `loginHeader` (rad 1496): `height: 56` → `minHeight`
- [x] `providerSwitcher` (rad 1376): `height: 48` → `minHeight`
- [x] `monitorProviderSwitcher`: fast `width: 174, height: 40` → `minHeight` och låt bredden växa
- [x] Sätt `maxFontSizeMultiplier` på siffror över 40 px, där `monitorMetric` på 104 px redan är i taket
- [ ] Testa med Större text på max i iOS-inställningarna

Semantik och tryckytor.

- [x] `accessibilityRole="tab"` på tjänstevalen (rad 1008) och `"tablist"` på behållaren, i stället för `"button"`
- [x] Avbryt och Klar (rad 829) är text med `hitSlop 12`, alltså cirka 42 punkter. Ge dem `minHeight: 44`

Klart när: appen uppfyller WCAG 2.2 AA, som `PRODUCT.md` redan satt som krav.

> Dynamic Type och responsivitet är samma problem sett från två håll: fasta mått som inte kan växa. Gör F8 och Steg 1b i samma svep, det är samma rader som ändras.

### F4a · Ta bort svarstidsraden ur huvudvyn
**P1 · insats mycket låg · risk ingen**

- [x] Ta bort `Direkt från Claude · 1.34 s` (rad 713)
- [x] Behåll `Uppdaterad nyss`, det är riktig användarinformation

Klart när: färskhetszonen har ett budskap i stället för två.

> Raden är redundant redan i dag: `createExperimentReport` innehåller själv `Refresh duration`, så mätningen finns kvar i den delade rapporten. **Dela-knappen ska däremot inte bort nu**, se F4b.

---

## Steg 1b — Responsivitet över enhetsstorlekar

**Utgångsläget: appen har noll storleksbrytpunkter.** Enda brytpunkten i hela kodbasen är `width > height` på rad 630 och 631, alltså orientering. Ingen kod skiljer på en liten och en stor skärm. `maxWidth` finns bara på inloggningspanelen och Codex-texterna, aldrig på dashboarden.

Referensbredder i punkter: iPhone SE 2 och 3 är **375 x 667**, iPhone 17 Pro Max ungefär **440 x 956**. Det är 43 procent mer höjd på den största telefonen, och appen utnyttjar inget av det.

### R1 · Porträttvyn har en punkt marginal på iPhone SE
**P0 · insats låg · risk låg**

Utloggat läge i porträtt på en SE summerar till 646 punkter av 647 tillgängliga:

```
insets.top                20
content paddingTop        16
header minHeight          72
gap                       24
providerSwitcher          48
gap                       24
signInPanel minHeight    430
paddingBottom             32
                        ----
                         646   av 667 - 20 = 647
```

Allt som tillkommer tvingar scroll: felkortet, en rad extra text, eller minsta höjning av systemtextstorleken. Det är därför tjänsteväljaren klipptes i toppen på testtelefonen.

- [x] Sänk `signInPanel` `minHeight: 430` (rad 1462) till ett värde som inte äter hela skärmen, eller gör det höjdberoende
- [x] Krymp `header` `minHeight: 72` (rad 1371) på låga skärmar, se även S10
- [x] Minska `content` `gap: 24` (rad 1369) på skärmar under 700 punkters höjd
- [ ] Testa utloggat, inloggat, felläge och laddningsläge på 375 x 667 innan något annat

Klart när: utloggat läge på en SE ryms utan scroll, även med felkortet synligt och en nivå större systemtext.

### R2 · Inför riktiga brytpunkter i stället för bara orientering
**P1 · insats låg · risk låg**

- [x] Härled ett fåtal namngivna storlekar ur `useWindowDimensions`, exempelvis `isCompactHeight` under 700 punkter och `isWide` över 500 punkter
- [x] Skala de tre största avstånden och de tre största typsnittsgraderna mot dessa, inte varje värde
- [x] Håll det till några få brytpunkter. Ett skalsystem per element blir omöjligt att underhålla

> Gör detta före R3 och R4, annars görs samma villkor om på tio ställen.

### R3 · Utnyttja höjden på stora telefoner
**P2 · insats låg · risk låg**

I dag ser en 17 Pro Max ut som en SE med 289 punkter tomrum längst ned, eftersom alla mått är fasta.

- [x] Låt primärkortets siffra växa på hög skärm, `primaryValue` är låst till 52 px (rad 1412-området)
- [x] Låt `stack` `gap: 22` andas mer när höjden tillåter
- [ ] Överväg att visa förbrukningstakten från F10 här, det är den ytan som finns över

### R4 · Sätt maxbredd på dashboarden
**P1 · insats mycket låg · risk ingen**

Primärkortet och gränskortet har ingen `maxWidth`. I landskap på en stor telefon blir progressbaren över 800 punkter bred, vilket gör att en fylld och en nästan fylld mätare ser likadana ut.

- [x] Ge `stack` samma behandling som `signInPanel` redan har: `maxWidth` omkring 620 och `alignSelf: 'center'`
- [x] Kontrollera att `primaryTrack` och `limitTrack` förblir läsbara vid maxbredden

### R5 · Login-overlayn i landskap
**P1 · insats låg · risk låg**

`isMonitorMode` exkluderar `isShowingLogin`, så inloggning i landskap använder porträttlayouten. På en SE i landskap är det 375 punkters höjd, och `loginHeader` 56 plus `loginHint` minHeight 54 äter 110 av dem innan WebViewen får något.

- [x] Gör `loginHint` till en enrading i landskap, eller fäll in den i headern
- [ ] Kontrollera Codex-panelen i landskap, den är en `ScrollView` med centrerad text i `maxWidth: 350` och blir mycket smal i förhållande till ytan
- [ ] Verifiera att tangentbordet inte täcker inloggningsfältet i landskap, där finns ingen `KeyboardAvoidingView` i dag

### R6 · Bestäm iPad medvetet
**P2 · insats medel om ja, ingen om nej · risk låg**

`app.json` har `"supportsTablet": false`, så appen körs skalad på iPad. Det är ett rimligt val för en experimentklient, men det är just nu ett outtalat val.

- [ ] Ta ställning: antingen behåll `false` och skriv ner varför, eller sätt `true` och gör då R2 och R4 först
- [ ] Sätts den till `true`: monitor-läget är den vy som vinner mest på en stor skärm, och den kräver minst arbete för att fungera där

Klart när: beslutet står i `docs/PRODUCT.md` i stället för att vara en flagga ingen diskuterat.

---

## Steg 2 — Efter EXP-001

Gate: `docs/CREATE-APP-PLAN.md` har fortfarande "Run 20 paired observations with three testers" obockad. Dela-observationsknappen är i aktiv användning av experimentet. Rör den inte förrän experimentet levererat eller F11 gett den ett hem.

### F3 · Gemensam översikt för Claude och Codex
**P0 · insats medel · risk medel · bygger på F1**

- [ ] Gör startvyn till två kompakta rader, en per tjänst, med akut fönster i procent plus tid till återställning
- [ ] Tryck på en rad expanderar till dagens primärkort med alla fönster
- [ ] Behåll tjänstefärgerna som identitet
- [ ] **Ta bort `ProviderSwitcher` helt** när båda syns samtidigt
- [ ] Har användaren bara anslutit en tjänst: visa den expanderad direkt, inget extra tryck
- [ ] Ta bort den tvingade omhämtningen vid tjänstebyte (rad 373 nollar `lastRefreshAttemptAtRef`)

Klart när: frågan "var har jag kapacitet kvar" besvaras utan ett enda tryck.

> Båda snapshotsen ligger redan i `snapshots` samtidigt. Begränsningen är rent visuell. En borttagning betalar för tillbyggnaden.

### F11 · Inställningsvy, och Codex-inloggning som minns
**P2 · insats medel · risk låg**

- [x] ~~Ny route i `ClaudeUsageExpo/app/`~~ Byggdes som overlay i samma komponent i stället, samma mönster som login-overlayn redan använder. Ingen navigation behövdes, och appen är fortfarande en skärm
- [x] ~~Kugghjul~~ Hamburgare i rubriken, ersätter Konto-knappen. Syns nu **alltid**, vilket också löser S1
- [x] Innehåll: anslutna konton med koppla bort och inloggning per tjänst, samt integritet och diagnostik under Om appen
- [ ] Notisval i menyn, kräver F7
- [ ] Spara flagga för att Codex prerequisite-steget är avklarat och hoppa direkt till kodskapandet nästa gång
- [ ] Liten länk kvar till ChatGPT-inställningen för den som behöver tillbaka
- [ ] **Nytt:** menyn är oåtkomlig i liggande monitorläge, eftersom `LandscapeMonitor` har egen header utan hamburgare. Rotera tillbaka fungerar, men det bör lösas

Klart när: Codex-flödet går från åtta steg till fem för alla utom förstagångsanvändaren.

### F4b · Flytta dela-observation till inställningar
**P1 · insats mycket låg · kräver F11 eller avslutad EXP-001**

- [x] Flytta `shareObservation` till menyn. Behöll `Share` i stället för klippbordet, eftersom EXP-001:s testare använder delningsbladet i dag. Avstängd med förklarande text när usage saknas
- [ ] Ta bort helt när EXP-001 är avslutat

> `PRODUCT.md` förbjuder i sina anti-references testinformation med samma visuella vikt som kärnuppgiften.

### F12 · Lämna Expo Go för en development build
**P2 · insats medel · risk låg · redan P1 i CREATE-APP-PLAN.md**

- [ ] Gör steget **efter** att EXP-001 levererat sina 20 parade observationer, inte före
- [ ] Blockerar F7, eftersom notiser inte fungerar i Expo Go på iOS

Klart när: Claude-sessionen bor i appens egen container i stället för i Expo Gos delade cookielager. Integritetspåståendet i gränssnittet blir då tekniskt sant, inte bara sant mot nätverket.

### F7 · Lokala notiser vid återställning och vid 80 procent
**P1 · insats medel · risk låg · kräver F12 och F11**

- [ ] Lägg till `expo-notifications`, finns inte i `package.json` i dag
- [ ] Ny modul i `src/infrastructure/`, isolerad som `codexDeviceAuth` redan är
- [ ] Schemalägg lokal notis direkt till `resetsAt`, schemalägg om vid varje uppdatering
- [ ] 80-procentsvarning triggas i samma kod som redan sätter röd färg vid 90
- [ ] Båda valen av som standard, styrs från inställningar
- [ ] Avboka schemalagda notiser när ett konto kopplas bort

Klart när: appen slutar kräva att man tittar på den för att göra sitt jobb.

> Kräver varken server eller bakgrundskörning, vilket är hela poängen. `resetsAt` är redan känt.

### Småfixar, samlade
Alla P1 eller P2, alla små. Ta dem när ni är inne i respektive fil.

- [x] **S1** Konto-knappen renderas bara när `snapshot` finns. Löst av hamburgaren, som alltid syns
- [ ] **S2** Två uppdateringsvägar gör samma sak. Behåll pull to refresh, ta bort den runda knappen
- [ ] **S3** Claude-login kräver att användaren trycker Klar. Bryggan upptäcker redan lyckad inloggning, så gör Klar till fallback i stället för instruktion
- [ ] **S4** Google-varningen visas efter att användaren tryckt. Nämn e-post och Apple som alternativ innan
- [ ] **S5** WebViewen har ingen laddningsindikering. Mellan tryck och renderad sida är det en tom yta
- [ ] **S6** Codex: slå ihop kopiera och öppna Safari till ett tryck, med texten `Koden är kopierad, klistra in i Safari`
- [ ] **S7** Codex: räkna ner kodens 15 minuter, `authorization.expiresAt` finns redan
- [x] **S8** Felmeddelanden är tekniska. `Claude returnerade HTTP 500` beskriver protokollet, inte nästa steg. 429-fallet gör redan rätt, kopiera det mönstret
- [ ] **S9** Tre tillstånd delar `signInPanel` med `minHeight: 430`. En tillfällig laddning ser lika dramatisk ut som ett trasigt konto. Ge laddningen en låg, lugn variant
- [ ] **S10** Rubriken tar 72 punkter för att säga `Usage`. Krymp och lägg statusraden bredvid i stället för under
- [ ] **S11** Rubriken `Övriga gränser` (rad 695) står över en enda rad när det bara finns ett sekundärt fönster. Dölj rubriken då
- [x] **S12** Integritetstexten flyttad till menyns Om appen. Hela `utilityRow` kunde tas bort, tillsammans med sex nu döda stilar
- [ ] **S13** De två assurance-raderna på inloggningsskärmen säger delvis samma sak. Gör en
- [ ] **S14** För många likvärdiga ytor i porträtt: switcher, primärkort, gränskort, felkort och inloggningspanel har alla samma radius och hairline-ram. Primärkortet har accentfärg och behöver ingen ram

### F19 · Visa att något pågår, ärligt
**F19a klar 2026-09-04 · F19b och F19c kräver F10**

Först vad som **inte** går. Enda datakällan för Claude är `/api/organizations/{id}/usage`, som returnerar aggregerade procentsatser och återställningstider. Det finns ingen ändpunkt för sessionsaktivitet, alltså kan appen inte veta att en modell genererar just nu eller att den blev klar. En indikator byggd på en pollning var sextionde sekund vore en gissning presenterad som fakta, samma invändning som mot F14. Bygg inte det.

Tre ärliga varianter finns i stället.

**F19a. Hämtningsindikator.** Visar att *appen* hämtar, vilket är det enda framsteg den faktiskt kan observera.

- [x] `src/features/dashboard/RefreshProgressBar.tsx`, en obestämd 3-punktersstripp överst i innehållet
- [x] Behåller sin höjd även när den är inaktiv, så layouten under aldrig hoppar
- [x] Respekterar `useReducedMotion()`, då står stapeln still i mitten i stället för att svepa
- [x] Dold för VoiceOver, den bär ingen information som inte redan finns i statusraden
- [x] Verifierad: segmentet sveper från minus sin egen bredd till trackets bredd, 12 unika positioner över 1,3 sekunder, och porträttvyn behöver fortfarande inte scrolla

**F19b. Kvotpuls.** Den ärliga versionen av "något arbetar just nu". Ersätter det tidigare F16, som var samma funktion under ett annat namn.

- [x] Jämför utnyttjande mellan två pollningar. Steg uppåt betyder att något förbrukade kvot senaste minuten
- [x] Pulserande prick plus `Kvoten rör sig · +0,4 % senaste minuten`
- [x] Visa **ingenting** när det står still. Tomt är rätt svar
- [x] Formulera det som kvoten, inte som personen. Ökningen kan komma från en annan enhet eller en glömd session, vilket är en av funktionens poänger
- [ ] **Kvarstår att kontrollera på riktigt konto:** att ändpunkten returnerar bråkdelar. Koden bevarar decimaler hela vägen och pulsen visar en decimal, men går svaret bara i heltal blir signalen trubbig för lätt användning. Syns pulsen aldrig vid normalt arbete är det förklaringen
- [ ] Upplösningen är 60 sekunder. Snabbare pollning är inget alternativ, 429-hanteringen finns av ett skäl

**F19b, resultat.** Klart 2026-09-04. `computeRecentDelta` i `src/domain/history.ts`, tio enhetstester gröna. Trösklar: minst 0,1 procents ökning, spann mellan 20 sekunder och 6 minuter, och en logg äldre än 6 minuter slutar hävda aktivitet så en stängd app inte ser aktiv ut.

`PulseDot` är en halo bakom en solid prick. Själva pricken rör sig aldrig, så tillståndet är läsbart även när `useReducedMotion` stoppar halon.

Visas i **båda** vyerna: i porträtt i färskhetsraden i stället för `Uppdaterad nyss`, i liggande i headern i stället för `Claude · anslutet`.

En inkonsekvens jag byggt in och rättade: monitorn visade pulsen även när datan var gammal, eftersom den inte fick `isStale`. Villkoret ligger nu i härledningen i stället för i varje vy, så vyerna inte kan glida isär. Att påstå rörelse just nu medan senaste anropet misslyckats vore fel.

**F19c. Aktivitetsremsa.** Den coola grafiken, men en som informerar.

- [x] En rad små staplar över de senaste timmarna, höjd efter förbrukning
- [x] Då syns skurar av arbete i stället för bara en nivå
- [x] Kräver historikloggen i F10

**Resultat, klart 2026-09-04.** `buildActivityBuckets` i `src/domain/history.ts`, tolv enhetstester gröna. Femton luckor à 20 minuter, alltså fem timmar, i `ActivityStrip.tsx`.

Beslut i den: tomma luckor behåller ett hårstreck på 2 punkter, så femtimmarsspannet läses som ett spann i stället för att staplarna verkar börja där första arbetet råkade ske. Ingen animation, det är data. Returnerar `null` vid färre än tre aktiva luckor, för en rad tomma staplar hade låtsats vara information.

En återställning inuti en lucka ger noll, aldrig en negativ stapel. Hur mycket som förbrukades före återställningen går inte att återskapa, och noll är det ärliga svaret.

Uppmätt med fyra arbetsskurar: `[2,17,2,2,2,12,2,2,2,28,2,2,2,13,5]`.

**Klar-signalen** finns redan som en verklig händelse: en gräns som återställs. Det är F7 för notis, plus en puls i gränssnittet när det inträffar medan appen är öppen. Det är den enda `något blev klart`-händelsen appen kan belägga.

### Beslut · Pil plus prediktionens klockslag under återställningstiden
**Fastställt 2026-09-04 av produktägaren, ersätter det tidigare ikon-bara-beslutet**

Primärkortets fot har nu två rader:

```
🕐 Återställs kl. 17:39
↗ Slut kl. 15:10
```

Pilen säger om takten håller, klockslaget är prediktionen. Tryck ger hela meningen i bubblan.

`NoteBadge` tar nu en valfri kort `label` vid sidan av glyfen, medan hela meningen ligger kvar bakom trycket och i `accessibilityLabel`. Alla fyra nottyper har en kort etikett:

| Ton | Etikett | Ikon |
|---|---|---|
| Takten hinner före reset | `Slut kl. 15:10` | pil upp |
| Takten räcker | `Slut kl. 21:40` | pil ner |
| Annan gräns närmare | `Veckogräns 96 %` | varning |
| Modell med mest utrymme | `Sonnet 4.5 12 %` | lager |

**En sak att hålla ögonen på.** När takten räcker ligger prediktionen efter återställningen, alltså inträffar den aldrig. Klockslaget visas ändå eftersom det var det som efterfrågades, och nedåtpilen plus meningen bakom trycket bär nyansen: `I den här takten skulle gränsen tagit slut kl. 21:40, men den återställs innan dess. Takten räcker.` Om det visar sig förvirra i praktiken är rätt åtgärd att byta etiketten i det fallet, inte att ta bort pilen.

Extraraden kostar höjd i liggande, så metriken går från 104 till 88 px när en not finns. Uppmätt: `Slut kl. 21:40` bottnar på 332 av 375 punkter, inget trunkerat, inget under kanten, i båda fallen och båda vyerna.

### Historik · Stödraden var en stund bara en ikon
**Överspelat av beslutet ovan**

Stödraden på primärkortet var först en textrad. Nu är den **en enda ikon** som pekar upp eller ner, och ett tryck visar meningen i en liten bubbla som försvinner av sig själv efter sex sekunder.

- `trending-up` betyder att takten hinner före återställningen
- `trending-down` betyder att den räcker
- `alert-circle` att en annan gräns är närmare
- `layers-outline` vilken modell som har mest utrymme

Ligger i `NoteBadge.tsx`. Hela meningen finns i `accessibilityLabel`, eftersom en tooltip som måste upptäckas genom att tryckas inte är ett sätt att leverera information till en skärmläsare.

Vinsten utöver ytan: liggande läge kunde få tillbaka hjältesiffran på 104 px, som jag tidigare tvingats krympa till 78 för att göra plats för textraden.

### Beslut · Klockslaget är primärt, nedräkningen ligger bakom ett tryck
**Fastställt 2026-09-04 av produktägaren, ersätter F6**

F6 gjorde nedräkningen primär. Det är omvänt nu: klockslaget står i vyn, eftersom det är vad man planerar efter, och ett tryck byter texten till återstående tid som byter tillbaka efter sex sekunder.

Ligger i `ResetLabel.tsx` och används på **alla fyra ställen** där en återställningstid visas, alltså primärkortet och gränsraderna i både stående och liggande läge. Konsekvens framför ett undantag på det viktigaste stället.

Detaljer:
- Datumet skrivs bara ut när återställningen **inte** är i dag, så en återställning samma dag blir kort
- Varje rad har eget tillstånd, ett tryck på en rad påverkar inte de andra
- `formatDuration` klarar nu dygn, eftersom veckogränsen ligger dagar bort. Singularformen finns: `1 dag kvar`, inte `1 dagar`
- Har fönstret ingen återställningstid ser raden inte ut som en knapp och beter sig inte som en
- Båda läsningarna ligger i `accessibilityLabel`, exempelvis `Återställs 7 sep. kl. 18:35. 3 dagar 4 h kvar.` En skärmläsare ska inte behöva upptäcka en tryckning för att få andra halvan

Textväxling på plats valdes framför en bubbla av ett konkret skäl: primärpanelen i liggande har liten marginal och en bubbla kan klippas där, medan en textväxling inte rör layouten.

Uppmätt i båda vyerna: inget trunkerat, inget under skärmkanten, före och efter tryck.

### Rättat · Återställningstexten kapades
**2026-09-04**

`Återställs om 1 h 57 min · kl. 16:24` var 315 punkter innehåll i ett 223 punkter brett fält i liggande läge, alltså klippt med ellips. Orsaken var mitt eget `numberOfLines={1}`.

Två åtgärder, för säkerhets skull båda: klockslaget är borta, eftersom nedräkningen är svaret och klockan var bälte och hängslen, och `numberOfLines` är höjt så en framtida lång sträng radbryter i stället för att klippas. Uppmätt efteråt: inget trunkerat i någon vy, i något tema, för någon tjänst.

### Verifierat · Allt fungerar för Codex
**2026-09-04**

Allt jag byggt är nycklat på `histories[activeProvider]` och `windowKey(primaryWindow)`, alltså providerneutralt. Verifierat med riktig Codex-data i stället för genom kodläsning:

| Funktion | Codex |
|---|---|
| Historik och aktivitetsremsa | 15 staplar, 66 % totalt |
| Kvotpuls | fungerar, samma tröskel |
| Nedräkning | `Återställs om 1 h 30 min`, inte kapad |
| Notikon | `Veckogräns är närmare sin gräns: 96 % använt.` |
| Tjänstefärg | Codex-blått `#7AA7FF` |
| Modellrad | visas inte, korrekt eftersom Codex inte har modellgränser |

### Beslut · Femtimmarsfönstret är alltid huvudfältet
**Fastställt 2026-09-04 av produktägaren**

Jag ändrade en gång primärvalet till det fönster som var närmast sin gräns, med hänvisning till designprincip 1 i `PRODUCT.md`, "visa den mest akuta usage-gränsen först". Det backades: femtimmarsprocenten ska alltid vara huvudfältet, i både stående och liggande läge, och veckovis vara sekundär.

Skälet är rimligt. Det är siffran man öppnar appen för att se, och en hjälte som byter plats gör layouten oförutsägbar.

Risken principen pekade på är verklig, och löses i stället av `buildPrimaryNote`: när ett annat fönster ligger över 90 procent **och** högre än femtimmars, visar kortet `Veckogräns är närmare: 94 % använt`. Alltså förutsägbar layout och ingen gräns som kan gömma sig.

Kortet visar **högst en** stödrad, vald i denna ordning:
1. Ett annat fönster är nästan fullt
2. Uppmätt takt, med projektion före eller efter återställningen
3. Vilken modell som har mest utrymme

Alla tre verifierade i previewen. Vid takt 40 procent per timme och 20 procent kvar visade den `I den här takten slut kl. 14:16, före återställningen`, exakt 30 minuter fram.

### F20 · Modell och resonemangsnivå
**F20a går att göra i dag · F20b och F20c går inte**

**F20a. Visa alla modellgränser, inte bara den mest ansträngda.** P1, insats låg.

Claude returnerar en lista `limits[]` där varje post med `kind: 'weekly_scoped'` bär `scope.model.display_name`. `parseScopedWindow` i `src/domain/usage.ts` bygger hela listan och gör sedan `.sort(...)[0]`, alltså **kastar bort alla utom den med högst förbrukning**. Har du veckogränser för både Opus och Sonnet ser du bara en av dem, utan att veta att den andra finns.

- [x] Returnera alla `weekly_scoped`-poster i stället för att sortera och ta första
- [x] `UsageWindow['id']` tillåter bara ett `'scoped'`, och listan använder `window.id` som React-nyckel. Byt nyckel till modellnamnet, annars kolliderar de
- [x] Märk raderna så det framgår **vad** de är. I dag står bara `Claude Sonnet 4.5` som radrubrik, vilket inte säger att det är en veckogräns per modell. Något i stil med `Veckogräns · Sonnet 4.5`
- [x] Sortera fallande på förbrukning, så den mest ansträngda modellen ligger först
- [x] Kontrollera att raderna får plats i liggande monitorläge, där panelen delar höjden mellan sina rader. Fler än två modeller kan behöva scroll eller en tätare rad

**F20a, resultat.** Klart 2026-09-04. Verifierat med åtta enhetstester på en nyttolast med tre modellgränser: alla tre behålls, sorterade `85,40,12`, poster utan modellnamn faller tillbaka på `Model limit`, fel `kind` filtreras bort, och nycklarna är unika. Före ändringen överlevde bara posten på 85 procent.

Två fynd på vägen:
- `secondaryWindows` filtrerade på `window.id`, vilket hade slängt **alla** modellgränser så snart en av dem var primär. Bytt till identitetsjämförelse.
- Tre modellgränser fyllde den liggande panelen till 374 av 375 punkter, alltså en punkts marginal. En fjärde hade spillt utanför skärmen. Lade till en kompakt variant som slår in vid tre rader eller fler och krymper värde, titel, track och luft.

Dessutom, som svar på önskemålet om att se det på primärkortet: kortet visar nu **`Mest utrymme: Sonnet 4.5 · 12 % använt`** när det finns fler än en modellgräns. Det är en faktaläsning ur gränserna, inte ett råd om vad som bör användas, och skillnaden är avsiktlig.

**F20b. Vilken modell som används just nu.** Går inte.

Femtimmarsfönstret är **inte modellspecifikt**, det är kontoövergripande. Så det finns ingen modell att sätta på primärkortet, ens i teorin. Det närmaste är raden om mest utrymme ovan.

Usage-ändpunkten bär gränser, inte sessionstillstånd. Det finns inget fält för vald modell. Att läsa det skulle kräva att appen började hämta konversationsdata från Claudes privata API, vilket är en stor integritetsutvidgning för en app vars hela poäng är att bara läsa aggregerad förbrukning. Gör inte det.

**F20c. Resonemangsnivå.** Går inte, och av två olika skäl.

För Claude är utökat tänkande en inställning per meddelande, inte en beständig kontoegenskap, och den finns inte i usage-svaret. För Codex ligger `model_reasoning_effort` i `~/.codex/config.toml` **på den dator som kör Codex**, alltså inte i molnet och inte något en iOS-app kan läsa.

> Det närmaste ärliga är F20a. Ser du att Opus-veckogränsen ligger på 85 procent medan Sonnet ligger på 12, så vet du i praktiken vad du bör välja, vilket är den fråga som ligger bakom önskemålet.

### F17 · Temaval i menyn
**P2 · insats låg · risk låg**

I dag följer appen enbart systemets läge. `useColorScheme()` avgör allt, och det finns ingen väg att välja själv.

- [x] `ThemePreference = 'system' | 'light' | 'dark' | 'halloween'`, med `system` som standard
- [x] Persistera under `usage-monitor.theme.v1`, samma mönster som snapshot-cachen
- [x] Egen sektion `Tema` i menyn med de fyra valen
- [x] Markera valt tema med bock, inte bara med färg, se F9
- [x] Systemvalet ska fortsätta följa telefonen när användaren byter läge under körning

### F18 · Halloween-tema med effekter
**P3 · insats medel · risk låg · påbörjad 2026-09-04**

Ett opt-in tema, alltså inget som påverkar standardupplevelsen. Färgerna är kontrastmätta i förväg mot WCAG AA, se tabellen nedan.

| Kontroll | Ratio | Krav |
|---|---|---|
| `ink` på `root` | 16,77:1 | 4,5 |
| `secondary` 12 px på `root` | 8,31:1 | 4,5 |
| `tertiary` 12 px på `surface` | 4,73:1 | 4,5 |
| `accent` som text på `surface` | 6,79:1 | 4,5 |
| `accentInk` på pumpaorange kort | 7,23:1 | 3 |
| Codex lilla accent som text | 5,08:1 | 4,5 |
| Dämpad korttext vid `opacity` 0,85 | 5,79:1 | 4,5 |

- [x] `HALLOWEEN_PALETTE`: djup lila-svart grund, pumpaorange accent, benvit text, giftgrön success, blodröd danger
- [x] Provider-teman: Claude pumpaorange, Codex häxlila
- [x] `src/features/dashboard/HalloweenAmbience.tsx` skriven med drivande 🎃 🦇 👻 och statiska 🕸️ på låg opacitet
- [x] `CandleGlow`, en irreguljär jack-o-lantern-flimring på primärkortet. Bara en varm genomskinlig hinna flimrar, aldrig texten ovanpå
- [x] Respekterar `useReducedMotion()` från Reanimated 4.5.1, allt står still när systemet ber om det. Det täcker samtidigt den lucka jag flaggade i granskningen, att appen inte hanterade reducerad rörelse alls
- [x] Koppla in paletten och ambienslagret, kräver F17
- [x] Ambienslagret ska ligga först i `root` så det hamnar bakom allt innehåll, med `pointerEvents="none"`
- [x] Pumpa intill `Usage`-rubriken och i inloggningsikonen
- [ ] Verifiera på enhet att flimringen inte stör läsbarheten av den stora siffran

> Filen är skriven men **inte importerad**, alltså inte i bundlen och utan effekt på appen. Den använder medvetet utskrivna `position: absolute` med `top`, `left`, `right`, `bottom` i stället för `StyleSheet.absoluteFillObject`, som togs bort i React Native 0.86 och var orsaken till den ursprungliga overlay-buggen.

### F15 · Tjänststatus i gränssnittet
**P2 · insats låg · risk låg**

Båda tjänsterna har publika Statuspage-API:er, verifierade 2026-09-04:

| Tjänst | Ändpunkt | Svar vid kontrollen |
|---|---|---|
| Claude | `https://status.claude.com/api/v2/status.json` | `indicator: "none"`, All Systems Operational |
| OpenAI | `https://status.openai.com/api/v2/status.json` | `indicator: "minor"`, Partial System Degradation |

`status.anthropic.com` svarar 301 till `status.claude.com`, så använd slutadressen direkt. `indicator` är `none`, `minor`, `major` eller `critical`, vilket mappar rent till fyra tillstånd.

Nyttan är tydligast just i felläget. Vid kontrollen var OpenAI degraderat, och en användare som då får `Kunde inte uppdatera` hade fått veta att felet ligger hos OpenAI och inte hos hens konto eller nät.

- [ ] Ny modul i `src/infrastructure/serviceStatus.ts`, samma isolering som `codexDeviceAuth` redan har
- [ ] Hämta vid appstart och därefter högst var tionde minut, statussidor ändras långsamt
- [ ] Visa som en prick plus text intill tjänstens namn, aldrig färg enbart, se F9
- [ ] Visa bara när det **inte** är `none`. En grön prick som alltid syns blir brus
- [ ] Väv in i felläget: `OpenAI rapporterar driftstörning` i stället för bara `Kunde inte uppdatera`
- [ ] Faila tyst. Statusen är en förklaring, aldrig en förutsättning för att appen ska fungera

> Integritetsanmärkning som bör skrivas ner innan det byggs: detta blir appens första anrop utanför claude.ai och OpenAI. Ingen kontodata skickas, men Statuspage driftas av Atlassian, så användarens IP syns för en tredje part. Det påverkar inte påståendet om att inloggning och usage stannar på enheten, men det bör stå i `PRODUCT.md` att appen gör ett anonymt statusanrop.

### F10 · Historik och förbrukningstakt
**P2 · insats medel · risk låg**

- [x] Rullande logg per tjänst, exempelvis 48 timmar, i AsyncStorage
- [x] Beräkna förbrukning per timme
- [x] En mening under primärkortet: `I den här takten når du gränsen ungefär 16:40, alltså före återställningen`
- [x] **Visa ingenting** vid för få mätningar eller ojämn användning, hellre tyst än en dålig gissning
- [ ] Sparkline först om loggen visar sig läsbar, inte som ambition

**Resultat, klart 2026-09-04.** Ligger i `src/domain/history.ts`, helt rena funktioner, 18 enhetstester gröna. Persisteras under `usage-monitor.history.v1`, max 600 mätningar och 48 timmar.

Skyddsvillkor så att siffran aldrig blir en gissning: minst tio minuters spann, minst 0,5 procents ökning, och mätningar närmare än 45 sekunder slås ihop. Faller något av dem visas ingenting.

Det knepiga fallet är löst och testat: **en återställning mitt i serien nollställer beräkningen.** Ett fallande värde betyder att gränsen gick om, och mätningar därifrån och bakåt säger inget om den pågående perioden.

Sparkline byggdes medvetet inte. Först F19c, om loggen visar sig läsbar i praktiken.

Historiken låser nu upp **F19b**, kvotpulsen.

### Kodstruktur
**P2 · insats låg · risk ingen**

`UsageDashboard.tsx` är 1 573 rader med state, nätlogik, fyra presentationskomponenter och cirka 280 rader stilark. Ingen stor omstrukturering behövs, men två utbrytningar är riskfria och gör resten läsbar.

- [ ] Flytta `createStyles` till egen fil
- [ ] Flytta `LandscapeMonitor` med `MonitorLimitRow` till egen fil

### F13 · Widget eller Live Activity
**P3 · insats hög · risk hög · kräver F10 först**

Skulle göra att appen inte behöver öppnas alls, vilket är slutmålet för produkttypen. Men Claude-datan hämtas genom injicerad JavaScript i en WebView, och en widget-extension kan inte köra en WebView. Datan måste skrivas till en delad app group av huvudappen och kan bara vara så färsk som senast appen var öppen. En widget med timmar gammal data är sämre än ingen widget. Codex, som går via ett riktigt token, skulle fungera.

- [ ] Bygg F10 först. Historiken avgör om en prognos är pålitlig nog att visas utanför appen

---

## Bygg inte

### F14 · Automatisk rekommendation av Claude eller Codex
Appen har två procentsatser och ingen kunskap om uppgiften, verktyget eller modellvalet. En rekommendation byggd på det är en gissning som ser ut som ett råd, och den undergräver det enda appen faktiskt levererar, nämligen siffror man kan lita på. F3 ger samma nytta utan att låtsas veta något.

### Flikar eller bottennavigation
Appen har en uppgift och den ryms på en skärm. Att dela upp den lägger till tryck utan att lägga till svar. F11 är en modal, inte en flik.

---

## Lämna orört

Det här fungerar redan och ska inte "förbättras".

- Integritetsarkitekturen. Inga anrop till appägd server, enda externa värdarna i `src/` är `claude.ai`, `chatgpt.com`, `api.openai.com`, `auth.openai.com`
- Keychain-nyckelvalet `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, korrekt för den här datan
- `mapCodexWindowsByDuration` i `src/domain/usage.ts`, som identifierar fönster på deklarerad varaktighet i stället för på position i svaret. Rätt beslut mot ett odokumenterat API
- Inga `console.`-anrop i `src/`, så inga tokens läcker till Metro-loggen
- Färgtemat per tjänst, som gör det omöjligt att missta Claude för Codex
- 429-hanteringen, som redan har ett åtgärdsinriktat meddelande

---

## Beslutslogg · Glastemat

### Panelen lyfter med ljus över gradient, sjunker med mörker över foto
Första versionen la ett fast mörkt skikt på 0,72 under varje panel. Det var mätt mot värsta fallet "helvit bakgrund", men gällde även de inbyggda gradienterna, och där köper det ingenting: mot den ljusaste punkt någon inbyggd bakgrund innehåller (`#233156`, toppen av Skymning) klarar **en helt genomskinlig panel** AA med ink 11,92:1, sekundär 7,88:1 och tertiär 4,86:1. Skiktet dolde alltså hela effekten utan att bidra till läsbarheten, och panelerna såg ut som vanliga mörka kort.

Nu avgörs riktningen av om bakgrunden är känd:

- **Inbyggd gradient** · känd och mörk, så panelen lyfter med ljus, `liftAlpha` 0,11
- **Egen bild** · okänd, så panelen sjunker med mörker, `scrimAlpha` 0,62 plus 0,42 direkt på bilden
- **Panel på panel** · mörknar alltid, `raisedAlpha` 0,30, oavsett bakgrund

Den sista regeln är ett eget beslut. Att lyfta med ljus ovanpå en redan ljuslyft panel adderades ihop, `#3d4a6a` blev `#5e6984`, och sekundärtexten föll till 3,40:1. Att mörkna är en regel för båda bakgrunderna och kan bara öka kontrasten.

### Tre färger skiljer sig från övriga teman, och bara därför att de föll igenom
`tertiary` `#B4B9C2`, accenten `#F4A488` (Claude) / `#99B7F7` (Codex) och `danger` `#FF9C93`. Var och en är det ljusaste värdet på sin egen kulör som fortfarande klarar 4,5:1 på alla åtta paneler. Accenten används som textfärg ("Logga in", "Stäng"), inte bara som fyllning, så ett fyllningsvärde hade inte räckt.

Sämsta värde över samtliga åtta fall: ink 8,49 · sekundär 5,61 · tertiär 4,62 · Claude-accent 4,56 · Codex-accent 4,54 · success 4,53 · danger 4,52. Varje panel skiljer sig också synligt från det som ligger under, mellan 1,20x och 3,93x.

### Android behöver ett blurTarget, annars finns ingen blur alls
`expo-blur` tvingar `BlurMethod.NONE` om en `BlurView` inte får ett `blurTarget`, och målar då ett platt skikt i stället. Det står i `ExpoBlurView.kt`:

```kotlin
val safeMethod = if (blurTarget != null) { method } else { BlurMethod.NONE }
```

Därför ligger `AppBackground` i en `BlurTargetView` vars ref går via context till varje panel. Bara bakgrunden ligger i målet, aldrig panelerna, annars samplar bluren sig själv. På iOS är `BlurTargetView` en vanlig `View` och det kostar ingenting.

Android lägger dessutom alltid på ett eget mörkt skikt med alfa `intensity/100 * 0,70` för varje mörkt material. Det kan bara mörkna, så det kan aldrig sänka ljus text under AA, men det gjorde att en panel med iOS-lyftet på 0,06 blev en smutsig fläck i stället för frostat glas. Därför är `liftAlpha` 0,11, mätt så att panelen syns tydligt (1,34x mot bakgrunden) på båda plattformarna.

`blurMethod` ersätter `experimentalBlurMethod`, som är deprecerad, och varianten är `dimezisBlurViewSdk31Plus` eftersom `dimezisBlurView` enligt Expos egen dokumentation kostar prestanda på Android SDK 30 och lägre.

### GlassSurface är avsiktligt inte animerad
En tidigare version mjukade upp fyllningen med `useAnimatedStyle`. Det **kraschade appen**: worklet-en körde `glassFill` på UI-runtimen, där modulen och dess regex inte finns, och felet avbröt processen. Det gav heller ingenting, eftersom fyllningen bara ändras när bakgrunden gör det och `AppBackground` redan kryssblandar i det ögonblicket. Ett dussin paneler renderas samtidigt, så att komponenten är vanlig React håller den också billig.

### Landskapsläget dolde temat helt
`monitorSafeArea` hade `backgroundColor: '#0E0F11'` hårdkodat och `monitorPrimary` fylldes med `providerTheme.monitorAccent`. Tillsammans gjorde de landskapsläget "bara orange och mörkt" oavsett tema. Båda är nu genomskinliga när glastemat är aktivt, och panelernas innehåll vänder från mörk text på accentfyllning till ljus text på glas via `heroInk` / `heroFill` / `heroTrack` i `createStyles`.

### Batteri
- `useKeepAwake` anropades ovillkorligt och höll alltså skärmen tänd på **varje** skärm så länge appen var öppen. Den ligger nu i `<KeepScreenAwake />` som bara renderas i landskapsläget, som är det enda läget som är tänkt att stå på ett skrivbord. Hooken har ingen villkorlig form, därav komponenten
- Pollningstimern revs tidigare inte ner när appen gick till bakgrunden, den fortsatte ticka varje minut och föll på en `AppState`-kontroll. Nu stoppas den vid bakgrund och startas igen vid återkomst, med en direkt uppdatering

### Rubriken finns bara i porträttläge
Landskapsläget startar utan rubrik, så panelerna får hela skärmen. Det gav också tillbaka den höjd som `monitorHeader` åt, vilket var det som klippte tredje gränsen på 320 punkters höjd.

Rubriken är inte borttagen, bara dold. Ett tryck på skärmen visar den och den försvinner själv efter fyra sekunder. Anledningen är att menyn är enda vägen till inställningar, tema och bakgrund, och tjänstväljaren enda vägen att byta mellan Claude och Codex. Att tvinga en rotation för att nå dem hade varit ett sämre svar än ett tryck.

Två saker som provades och förkastades:

- **Rubriken som flytande lager över panelerna.** Den täckte veckosiffran, alltså precis det man kan vara mitt i att läsa. Den ligger nu i flödet igen, så panelerna krymper i stället för att skymmas, och geometrin blir exakt den som redan var verifierad
- **Tryckytan med `accessibilityRole="button"`.** En knapp som omsluter andra knappar är fel semantik överallt, och på webben var det dessutom ogiltig markup, `<button>` inuti `<button>`, som React vägrade rendera. Ytan är nu `accessible={false}` och fungerar som en bakgrundsgest, så som man trycker på en video för att få fram dess kontroller

`monitorRoot` hade också `#0E0F11` hårdkodat och är nu genomskinlig på glas, av samma skäl som `monitorSafeArea`.

### Verifierat på Android 16 (API 36, arm64) i emulator
`blurTarget`-fixen är bekräftad på riktigt, inte bara härledd ur källkoden. Testet var en egen bakgrundsbild av färgbrus med vitt rutnät på 24 pixlar, alltså innehåll med maximal detalj som en blur antingen förstör synligt eller inte alls:

- **Bluren fungerar.** Rutnätet är utsmetat till mjuka färgfält bakom panelerna, medan miniatyrbilden i "Egen bild"-raden visar originalet skarpt precis intill. Utan `blurTarget` hade pixelrutnätet synts rakt igenom ett platt skikt
- **Fotoskrimmen stämmer på decimalen.** Bildens vita fält renderas som `#9c9c9d`, exakt det värde 0,42 av `#07080A` över vitt ger i beräkningen
- Menyn, temavalet, alla fyra bakgrunderna, Androids fotoväljare, "Återställ till standard" och dess villkorade synlighet fungerar
- Panelerna sjunker med mörker över fotot och all text är läsbar, som mätningen förutsade
- `raisedAlpha`-beslutet syns tydligt: menykorten läses som nedsänkta paneler på ett ljusare ark
- Halloween-emojin renderar, och landskapsläget fungerar

Två saker att veta om emulatorn: den dog upprepade gånger med `FATAL | Running multiple emulators with the same AVD` innan `multiinstance.lock` rensades, och en emulator startad med `&` från ett verktygsanrop överlever inte anropet, den måste dubbel-forkas och få egen session.

### Appen är inte längre bara iOS, så copyn kan inte säga iPhone
Fyra strängar namngav en plattform: "stannar på din iPhone", "iOS Keychain" på två ställen och "iOS-inställningarna". På Android var de direkt felaktiga. De säger nu "din enhet", "enhetens säkra lagring" och "systeminställningarna", vilket är sant på båda, eftersom expo-secure-store är Keychain på iOS och Keystore-backad krypterad lagring på Android. Användaragenten på rad 89 nämner fortfarande iPhone, men den är avsiktlig, den efterliknar Safari mot claude.ai.

---

## Beslutslogg · Domäntesterna tillbaka

Testerna som fanns tidigare i arbetet blev aldrig committade och låg inte kvar på disk. De är återskapade: 45 tester över `history.ts` och `usage.ts`, alla gröna.

### Node kör TypeScript själv, så inget testverktyg behövdes
Node 24 strippar typer inbyggt och har en egen testkörare, och båda domänmodulerna är rena utan RN-importer. `npm test` är därför `node --test "src/**/*.test.ts"` utan jest, utan babel, utan transform. Enda nya beroendet är `@types/node`, som bara behövs för att typkolla testfilerna.

Två saker som krävde en riktig lösning:

- **Runtime-importer måste ha `.ts`-ändelsen.** `history.ts` importerar `./usage` utan ändelse och det fungerar, men bara därför att det är en `import type` som raderas helt före körning. En riktig import gör det inte, så testfilerna skriver `./history.ts` och `allowImportingTsExtensions` är påslaget
- **Node-typerna är avgränsade till testerna.** Med `types: ["node"]` i huvudkonfigurationen hade appkod kunnat använda `Buffer` eller `fs` och typkolla igenom, men krascha på enheten. Nu ligger de i `tsconfig.test.json`, huvudkonfigurationen utesluter `**/*.test.ts`, och `npm run typecheck` kör båda. Verifierat i båda riktningarna: `Buffer` i appkod ger fel, och ett riktigt typfel i en testfil ger också fel

Testerna hamnar inte i bundlen, eftersom Metro bygger på importgrafen. Kontrollerat: noll träffar på `node:test` i både iOS- och Android-bundlen.

### Testerna hittade en riktig svaghet i `computeRecentDelta`
Vakten mot falskt "Förbrukat" på kall start låg i `requireSampleAt`, men `null` betydde "hoppa över kontrollen". Standardvärdet pekade alltså åt fel håll för en säkerhetsvakt: en anropare som utelämnade argumentet fick tillbaka precis den bugg vakten fanns för. Appen var korrekt, eftersom det enda anropsstället redan kontrollerade `liveAt !== null` innan det anropade, men fällan låg kvar för nästa anropare.

`null` betyder nu "ingen mätning i den här sessionen, alltså inget att påstå", vilket är det säkra svaret. Kontrollen på anropsstället är kvar, den sparar onödigt arbete.

Tyngdpunkten i testerna ligger på vakterna, inte på de lyckade fallen, eftersom det är vakterna som varit fel: att en återställning inte får smitta takten, att ett fall i procent inte är aktivitet, att en tunn logg ger `null` i stället för en rad tomma staplar, och att varje modelltak följer med i stället för bara det högsta.

---

## Beslutslogg · Glaset får en yta som inte behöver någon blur

### Problemet var inte att bluren var trasig
Bluren fungerar på Android, det är verifierat. Men en blur syns bara där bakgrunden har detaljer att smeta ut, och de inbyggda gradienterna har medvetet inga. Över standardbakgrunden Grafit fanns det alltså ingenting för bluren att avslöja, och panelerna blev omöjliga att skilja från vanliga mörka kort. På iOS räddades det av systemmaterialet, som ljusar upp panelen även över en platt färg. Android har inget motsvarande.

Dessutom stänger `dimezisBlurViewSdk31Plus` av bluren helt på Android under SDK 31, alltså Android 11 och äldre. Där finns ingen blur alls att förlita sig på.

### Lösningen är en sheen, en ljusgradient över själva panelen
Panelens eget ljus spenderas nu som en diagonal gradient i stället för en jämn hinna. Det kräver ingen blur, ingen GPU-funktion och inget plattformsstöd, och det är samma visuella språk på båda plattformarna.

Sheenen kunde inte bara läggas ovanpå det som redan fanns. Paletten låg på 4,52:1 i värsta fallet, alltså utan marginal för mer ljus. Den **ersätter** den platta lyftningen i stället för att läggas till, så panelen spenderar samma ljus med riktning i stället för jämnt utspritt. Kontrasten blev till och med något bättre: sämsta värde 4,54 mot 4,52 tidigare.

Toppvärdet beror på bakgrunden, precis som tonen redan gjorde:

- **Inbyggd gradient** · sheen med topp 0,10. Det är fallet som behöver hjälp, eftersom bluren inte visar något där
- **Egen bild** · sheen med topp 0,025, alltså bara en antydan. Där måste panelen vara mörk för att bära text, och där har bluren faktiskt detaljer att avslöja

En enhetlig sheen på båda gick inte: fotofallet har ingen marginal och strypte den till 1,06x över panelen, vilket är osynligt.

### Mätt på skärmdumpen, inte bara i modellen
Uppmätt på Android över standardbakgrunden: **1,44x steg över panelen** och **1,62x mot den nakna bakgrunden intill**. Starkare än de 1,20x till 1,27x modellen förutsade, eftersom Androids egna mörka blurskikt drar ner panelens undre ände ytterligare.

Den uppmätta ljusa hörnan blev `#37383c`, alltså mörkare än modellens värsta fall `#39435d`, vilket ger mer marginal snarare än mindre. Kontrasten mot den faktiska panelen: ink 10,93 · sekundär 7,22 · tertiär 5,94 · accent 5,86 och 5,84 · success 5,83 · danger 5,82. Allt klarar AA med god marginal.

---

## Beslutslogg · Prestanda och batteri, andra omgången

Bygger vidare på pausningen av animationer och backoff vid misslyckad hämtning. Genomgången gjordes mot `vercel-react-native-skills`, installerad från vercel-labs/agent-skills, eftersom varken det egna skill-biblioteket eller förslagskatalogen hade något prestandaskill för mobilappar.

### Fyra regler prövades, tre bröts

**`animation-gpu-properties` (HIGH).** `UsageBar` animerade `width` i procent. Bredd är en layoutegenskap, så React Native räknade om layouten varje bildruta under hela övergången. Fyllningen är nu full bredd och skalas med `scaleX` från vänsterkanten, vilket körs på GPU:n utan att röra layouten.

Uppmätt i webbygget efteråt: 62, 8 och 96 procent renderar på exakt rätt längd, med `transform-origin` i vänsterkanten. Den rundade högeränden komprimeras visserligen horisontellt av skalningen, men på staplar som är 7 till 10 punkter höga med 4 till 5 punkters radie blir det bråkdelar av en pixel och syns inte.

**`js-hoist-intl` (LOW-MEDIUM).** Sex ställen byggde en ny `Intl.DateTimeFormat` eller `Intl.NumberFormat` vid varje anrop. Varje konstruktion gör en uppslagning av lokaldata, och de här körs vid varje omritning av varje rad som visar en tid eller ett procenttal. Alla ligger nu på modulnivå. Den som växlar mellan att visa år eller inte blev två hissade formatterare i stället för en byggd per anrop.

**`react-compiler-reanimated-shared-values`.** React Compiler är påslagen i det här projektet, och regeln säger att `.value` gör att kompilatorn hoppar av. Alla delade värden använder nu `.get()` och `.set()`. Migreringen riktades mot de fem faktiska shared value-namnen, inte mot `.value` generellt, eftersom `option.value` i temalistan är ett vanligt objektfält som inte får röras.

**`rendering-no-falsy-and` (CRITICAL).** Inga överträdelser. Koden använder redan ternära uttryck med `null`.

### Bakgrundsbilderna kostade mest av allt
De fyra Unsplash-bilderna låg på upp till 2400 pixlar. Det som spelar roll är inte filstorleken utan den avkodade bitmappen: 12 till 15 MB RAM per bild medan den visas, 57 MB för alla fyra. På en surfplatta med 1,5 GB är det mycket.

Nedskalade till 1600 pixlar på långsidan vid JPEG-kvalitet 80:

| | Före | Efter |
| --- | --- | --- |
| Buntade byte | 2,75 MB | 1,51 MB |
| Avkodat i minnet | 57,1 MB | 25,4 MB |

1600 täcker en telefon i sin egen upplösning och skalas bara måttligt upp på en surfplatta. Det syns inte, eftersom varje bakgrund ligger bakom en kontrastridå på 0,42 och suddas av panelerna ovanpå. Detaljerna förstörs av designen innan de når ögat. Kommandot för att återskapa finns i CREDITS.md.

### Granskning mot web-design-guidelines
De flesta reglerna är webbspecifika och saknar motsvarighet i React Native. Två gällde:

- **`UsageBar` var osynlig för skärmläsare.** Rätt åtgärd visade sig vara att märka den som dekoration, inte att lägga till en `progressbar`: stapeln upprepar ett procenttal som redan läses upp som text bredvid den, så en roll hade fått skärmläsaren att säga samma siffra två gånger
- **29 Ionicons saknar dolning för skärmläsare.** De som ligger inuti märkta `Pressable` grupperas och är oproblematiska, men de fristående ikonerna bredvid text är ren dekoration och blir brus. Inte åtgärdat i den här omgången, den handlade om prestanda

`prefers-reduced-motion` respekteras i alla fyra animerade komponenter, och `tabular-nums` används redan på de numeriska fälten.
