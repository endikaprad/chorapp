/* ============================================================
   frases.js — La frase de bienvenida para Ama (con retranca).

   window.Frases da:
     - delDia(fecha)        -> frase para la pantalla de Inicio
     - especialDeHoy(fecha) -> mensaje concreto si hoy es una fecha marcada
                               (cumpleaños, concierto, aniversario…)
     - enhorabuena()        -> frase corta al marcar una canción "Aprendida"
     - hito(dias)           -> frase al cumplir una racha redonda de estudio

   La frase CAMBIA cada vez que se entra a Inicio (no una por día):
   GENERALES y DOMINGOS se eligen al azar en cada visita, evitando
   repetir la de la vez anterior. Las de fecha (FECHAS, ESTACIONES,
   MESES) sí dependen del calendario.

   Prioridad:
     1. FECHAS      (cumpleaños, fiestas señaladas…) -> se muestra resaltada
     2. ESTACIONES  (el día que entra cada estación)
     3. MESES       (el día 1 de cada mes)
     4. DOMINGOS    (si es domingo; siempre metiéndose con su voz)
     5. GENERALES   (el resto de días; también metiéndose con su voz)

   Para añadir una fecha especial: mete una entrada en FECHAS con la
   clave 'MM-DD' (mes-día, con cero delante). El valor puede ser una
   frase o una lista de frases (se elige una por año). Si además
   quieres acotar el año, usa la clave 'AAAA-MM-DD'.
   ============================================================ */

window.Frases = (function () {
  'use strict';

  /* ---------- Frases de bienvenida (al azar en cada visita) ----------
     Todas con la misma broma de fondo: canta regular. Con cariño. */
  var GENERALES = [
    'Ensaya ahora, que los vecinos aún no han vuelto y así no hay testigos.',
    'El perro se esconde en cuanto abres la partitura. Él sabrá.',
    'Cinco minutos de la app hoy y me ahorras el karaoke sorpresa en la cena.',
    'Ponlo a 0,75x. A 1x eso no es una canción, es una alarma.',
    'Los platos del armario ya vibran solos cuando llegas al estribillo.',
    'Practica con la ventana cerrada. El barrio te lo devolverá en forma de silencio.',
    'Escucha la grabación buena antes de empezar. Por si se te pega la afinación.',
    'Ese gallo del compás 12 ya tiene nombre propio en esta casa.',
    'Si hoy solo mueves los labios, la familia lo agradece.',
    'Baja medio tono. O uno. O los que hagan falta, no pasa nada.',
    'Repite el trozo difícil con auriculares, que lo tuyo se comparte poco.',
    'Media hora bien hecha hoy o dos horas de nuestros oídos sufriendo mañana.',
    'Grábate y escúchate tú. Es lo justo, nosotros llevamos años.',
    'Marca el fragmento difícil. Marca casi todos, seamos sinceros.',
    'La afinación llega con repetición. Tú repite, que aún hay mucho margen.',
    'Hoy es buen día para cantar. Para el resto de la casa ya es otra historia.',
    'Si te sale un agudo raro, no era un adorno. Vuelve a intentarlo.',
    'Diez minutos y paras. El bis no lo pide nadie, créeme.',
    'Lee la letra en voz alta primero. La melodía la negociamos luego.',
    'Lo que hoy suena a sirena, en un mes quizá suene a canción.',
    'No corras los finales de frase, que se te van de tono y hay que ir a por ellos.',
    'Un café, la partitura y para dentro. Y la puerta bien cerrada.',
    'Te ha salido bien tres veces seguidas. Para ya, no tientes a la suerte.',
    'Cantar un rato relaja. A ti. A los que escuchan, según el día.',
    'Hoy vale con repasar lo de ayer, que lo dejaste a medio afinar.',
    'La constancia funciona aunque sea aburrida. Y tú, para constante, de matrícula.',
    'Ponte una sola meta hoy: acabar la canción en el mismo tono en que empezó.',
    'Si no te sale el agudo, no es el día. Y el vecino del quinto lo celebra.',
    'Trabaja el trozo, no la canción entera. Ni tú ni nuestros tímpanos tenemos tanto tiempo.',
    'Tu ritmo es el tuyo. El de la partitura, cuando puedas, pásate a saludarlo.',
    'Abrir la app ya es medio ensayo. El otro medio, si afinas, redondo.',
    'Afina con el piano de la app. Con la intuición llevas años perdiendo.',
    'Canta para ti primero. El estreno familiar que espere sentado.',
    'Hoy toca esa que dejaste a medias. Sí, esa. Todos sabemos cuál.',
    'Ensaya fuerte. Total, en esta casa ya nos hemos rendido.',
    'El agudo del final: o lo clavas o lo dejas, pero no lo arrastres.',
    'Escala arriba, escala abajo, y para. Que esto engancha más a quien lo hace que a quien lo oye.',
    'Si dudas del tono, no subas "a ver qué pasa". Ya sabemos qué pasa.',
    'Practicar en el coche está bien. Con las ventanillas subidas, mejor.',
    'Otra vez por aquí. La afinación sigue sin aparecer, pero tú insiste.',
    'Bienvenida. Los vecinos ya están cerrando ventanas, empieza cuando quieras.',
    'Hoy calienta la voz antes. Fría asusta; caliente, asusta menos.',
    'El coro te quiere. Que te quiera afinada ya es pedir mucho.',
    'Respira por el diafragma. Y por los demás, que llevamos aguantando un rato.',
    'Como sigas así de constante, un día hasta das la nota buena.',
    'Recuerda: la canción tiene un tono. Elige ese, no uno cualquiera.',
    'Empieza floja y ve subiendo. El susto, en pequeñas dosis.',
    'Si notas que desafinas, tranquila: nosotros también lo notamos.',
    'Media hora hoy. El barrio ha montado un grupo de WhatsApp por menos.',
    'Ese vibrato no es vibrato, es que te tiembla el pulso. Sujeta la nota.',
    'Canta la de siempre, que a la nueva todavía no está lista la familia.',
    'Buenas. El afinador de la app está deseando llevarte la contraria otra vez.',
    'Practica el estribillo. El puente ya lo tienes: puente derruido, pero puente.',
    'Hoy te propongo una locura: la misma nota que la del piano.',
    'Si te sale bien, grábalo. Nadie se lo va a creer sin pruebas.',
    'El gato del vecino se ha ido al balcón. Cinco minutos tienes antes de que salte.',
    'Abre la partitura. Las notas están ahí escritas para algo.',
    'Un ratito de escalas. Sí, esas cosas que subes y bajas sin acertar ninguna.',
    'Vas mejorando. Desde muy abajo, pero el gráfico sube.',
    'Hoy, calidad antes que volumen. Sobre todo volumen, baja el volumen.',
    'La vecina del 3º ha preguntado si ensayas o si necesitas ayuda. Ensayas.',
    'Tú dale. Roma no se afinó en un día y mira, sigue sin afinar.',
    'Concéntrate en no correr. Llegar tarde al tono también cuenta como fallar.',
    'Bienvenida de vuelta. La canción sigue ganándote 2 a 0.',
    'Prueba a cantar bajito. Es una técnica infravalorada en esta casa.',
    'Hoy la letra, mañana las notas, y en 2027 las dos a la vez.',
    'El truco del agudo es no tenerle miedo. El truco de escucharte es al revés.',
    'Ponte seria diez minutos. La siesta te espera y te la has ganado.',
    'Afinas mejor cuando crees que no te oye nadie. Spoiler: te oímos.',
    'Menos aire, más apoyo. Y una ventana menos abierta, gracias.',
    'La nota está. Solo tienes que dar con ella antes de que acabe el compás.',
    'Otra sesión. A este ritmo, en Navidad casi te sale entera.',
    'Canta como si nadie escuchara. Total, se van todos al oírte empezar.',
    'Hoy trabaja los finales. Ahí es donde la canción se te muere.',
    'Buenas. El diapasón ha pedido vacaciones, pero aquí sigue.',
    'Un consejo gratis: si la nota te sale sola y aguda, no era esa.',
    'Practica de pie. Se afina mejor y hueles el peligro antes.',
    'La constancia la tienes. El oído, en camino. La modestia, ya veremos.',
    'Si hoy te sale un agudo limpio, cierra la app y no toques nada más.',
    'Vamos con la de siempre. Los clásicos también los destrozas con más soltura.',
    'Recuerda beber agua. Y afinar. Sobre todo lo segundo.',
    'El coro entero reza para que hoy sí. Tú pon de tu parte.',
    'Media horita. Que luego dices que no avisé.',
    'Hoy en modo estudio, no en modo concierto en el salón, por favor.',
    'Tu voz tiene carácter. Le falta puntería, pero carácter le sobra.',
    'Empieza ya. Cuanto antes desafinas, antes descansamos todos.'
  ];

  /* ---------- Domingos (no trabaja: sin excusas, y a por su voz) ---------- */
  var DOMINGOS = [
    'Domingo. No trabajas, así que no tienes excusa para no ensayar esa voz que buena falta le hace.',
    'Es domingo y estás libre. Tiempo de sobra para dar por fin con el tono.',
    'Domingo sin curro. Media hora de escalas y aún te queda el día para que se te olvide lo mal que fueron.',
    'Domingo. Hoy los vecinos están en casa: cántales flojito, por caridad.',
    'Domingo libre: ni jefe ni horario. Solo tú y esa canción que te lleva ganando semanas.',
    'Hoy no trabajas. Aprovecha para trabajar la voz, que ni de lejos está fina.',
    'Domingo: el día perfecto para ensayar sin prisa mientras la familia se va lejos a que no le llegue el sonido.',
    'Domingo. Descanso para todos menos para tus cuerdas vocales, que hoy toca doble.',
    'Domingo. Sin madrugón, sin curro y sin afinación. Vamos a por lo tercero.',
    'Es domingo. Tienes todo el día para cantar mal a gusto y sin reloj.',
    'Domingo. Hasta el gato sabe que hoy hay sesión larga. Mírale la cara.',
    'Domingo libre. La única cita de tu agenda es con un agudo que no vas a dar.',
    'Domingo. Hoy no hay prisa: puedes desafinar despacio y saboreándolo.',
    'Descansa del trabajo, no del coro. Y menos con lo que le queda a esa voz.',
    'Domingo. Café, bata y una hora de ruidos que en esta casa llamamos ensayo.',
    'Es domingo: nadie te espera en ningún sitio. La canción, sí, y con ganas de revancha.',
    'Domingo. Si hoy con todo el tiempo del mundo tampoco afinas, ya es vocación.',
    'Domingo. Los vecinos han hecho planes fuera. Coincidencia, seguro.',
    'Domingo sin excusas. Ni "vengo cansada" ni "no tengo tiempo". Solo tú y tu oído, que van cada uno por su lado.',
    'Domingo. Aprovecha que no trabajas para pelearte con el estribillo hasta ganarle.',
    'Es domingo. El día del Señor y el día en que el Señor también te pide que afines.',
    'Domingo. Hoy la siesta te la ganas nota a nota. Empieza ya.',
    'Domingo libre. Perfecto para grabarte, escucharte y entender muchas cosas.',
    'Domingo. Sin alarma, sin oficina y, ojalá algún día, sin gallos.',
    'Domingo. Tienes ocho horas de luz para dar con una nota buena. Tiempo de sobra… en teoría.',
    'Domingo. La familia ha salido a pasear "por el aire fresco". El aire, claro.',
    'Es domingo: hoy hasta te dejamos poner el volumen que quieras. Bajito, eso sí.',
    'Domingo. Ni jefe que te mande ni tono que te obedezca. Al lío.',
    'Domingo. Un día entero para ti y para esa afinación que sigue de vacaciones.',
    'Domingo. Ensaya ahora, que después de comer nadie responde de nada.',
    'Domingo. Hoy toca repertorio largo y paciencia corta para tus oídos.',
    'Es domingo. El coro te quiere el miércoles. Afinada sería un extra.',
    'Domingo. Sin curro, sin líos y sin público. Aprovecha lo último.',
    'Domingo. Hoy que tienes calma, prueba esto raro: cantar la nota que pone en el papel.',
    'Domingo. La única reunión del día es tú contra un agudo. Ve preparando la derrota.',
    'Domingo libre: ideal para ensayar hasta que te salga o hasta que se queje alguien. Lo que llegue antes.',
    'Domingo. Hoy no hay prisa, así que no tienes disculpa para correrte el tono.',
    'Es domingo. Descansa la cabeza y cansa las cuerdas, que están fresquísimas de tan poco fino.',
    'Domingo. El sofá te llama, pero primero media hora de escalas cuesta arriba.',
    'Domingo. Con este día por delante, hasta tú deberías afinar una. Una.',
    'Domingo. Hoy los pájaros de fuera y tú de dentro, a ver quién desafina primero.',
    'Es domingo: sin obligaciones. Salvo con el diapasón, que te está esperando.',
    'Domingo. Aprovecha la mañana, que por la tarde la voz se te va todavía más.',
    'Domingo. Un clásico: tú con toda la tarde libre y la canción sin aprender.',
    'Domingo. Hoy sin reloj. Repite el compás difícil las veces que haga falta, que van a ser muchas.',
    'Es domingo. Ni curro ni prisas. Solo esa vocecilla tuya pidiendo ensayo a gritos.',
    'Domingo. La casa para ti sola. Nadie a quien pedir perdón por el do de pecho.',
    'Domingo. Empieza pronto, que el margen de mejora es enorme y el día se acaba.',
    'Domingo. Hoy que descansas de todo, no descanses de afinar, que es lo que urge.',
    'Domingo. Sin excusas laborales. Toca darlo todo y, con suerte, dar alguna nota.'
  ];

  /* ---------- Entrada de mes (día 1) ---------- */
  var MESES = [
    'Enero. Año nuevo, mismas notas falsas. A por ellas.',
    'Febrero, mes corto: menos días para ensayar, más para lucirte. O no.',
    'Marzo. Se alarga la luz y los ensayos en la terraza. Que se prepare el barrio.',
    'Abril. Aguas mil y escalas mil, pero dentro de casa.',
    'Mayo. Buen mes para cantar con la ventana abierta. Tú ciérrala igual.',
    'Junio. Empieza el calor y las canciones de verano. Hidrátate y afina.',
    'Julio. Todo el mundo de vacaciones y tú dándole a las escalas. Respeto.',
    'Agosto. Pueblo, fiestas y alguna ronda improvisada. Ve calentando.',
    'Septiembre. Vuelta al coro y a las excusas. Este año menos, ¿eh?',
    'Octubre. Se acortan los días, no los ensayos.',
    'Noviembre, mes de Santa Cecilia. Toca ponerse las pilas de verdad.',
    'Diciembre. Villancicos a la vista. Que no te pillen sin ensayar.'
  ];

  /* ---------- Entrada de estación ---------- */
  var ESTACIONES = {
    '03-20': 'Hoy entra la primavera. Ventanas abiertas, alergias y tu voz sonando por todo el portal.',
    '06-21': 'Empieza el verano. Menos ropa, más terrazas y conciertos de coro sudando. Ánimo.',
    '09-23': 'Llega el otoño. Té, manta y esa canción que dejaste a medias en junio.',
    '12-21': 'Entra el invierno. Abrígate la garganta, que aún te queda repertorio.'
  };

  /* ---------- Fechas marcadas ----------
     Clave 'MM-DD' (todos los años) o 'AAAA-MM-DD' (un año concreto).
     Valor: frase o lista de frases. Rellena las que faltan. */
  var FECHAS = {
    // --- Fiestas ---
    '01-01': 'Feliz año, Ama. A ver cuántas canciones caen este (espero que no muchas).',
    '01-06': 'Feliz día de Reyes. Hoy descansa, POR FAVOR.',
    '12-24': 'Feliz Nochebuena. Si cae villancico en la sobremesa, ya lo tienes ensayado.',
    '12-25': 'Feliz Navidad, Ama. No comas muchos polvorones, que luego hay que cantar.',
    '12-31': 'Fin de año. Échale un ojo al calendario de práctica, que has cantado mucho.',

    // --- Fiestas de Llodio / Halloween ---
    '08-15': 'Txupinazo en Llodio. Hoy manda la fiesta, no el coro. Disfruta (y bebe agua).',
    '10-31': 'Halloween. La única noche en que si desafinas asustando, cuenta como acierto.',
    // Morcillas de Llodio: último sábado de agosto
    '2026-08-29': 'Sábado de morcillas en Llodio. Hoy se canta poco y se come mucho. Permitido.',
    '2027-08-28': 'Sábado de morcillas en Llodio. Hoy se canta poco y se come mucho. Permitido.',
    '2028-08-26': 'Sábado de morcillas en Llodio. Hoy se canta poco y se come mucho. Permitido.',
    '2029-08-25': 'Sábado de morcillas en Llodio. Hoy se canta poco y se come mucho. Permitido.',
    '2030-08-31': 'Sábado de morcillas en Llodio. Hoy se canta poco y se come mucho. Permitido.',
    // (a partir de 2031, añadir el último sábado de agosto de cada año)

    // --- Día de la madre (primer domingo de mayo en España) ---
    '2026-05-03': 'Feliz día de la madre, Amatxu.',
    '2027-05-02': 'Feliz día de la madre, Amatxu.',
    '2028-05-07': 'Feliz día de la madre, Amatxu.',
    '2029-05-06': 'Feliz día de la madre, Amatxu.',
    '2030-05-05': 'Feliz día de la madre, Amatxu.',
    // (a partir de 2031, añadir el primer domingo de mayo de cada año)

    // --- Cumpleaños de la madre de Maite (falleció) ---
    '04-09': 'Hoy era el cumpleaños de amama. Ella te escucha.',

    // --- Cumpleaños del marido de Maite ---
    '12-02': 'Hoy es el cumpleaños de aita. Cántale algo, que le hace ilusión aunque disimule.',

    // --- Cumpleaños de Endika (el hijo) ---
    '10-27': 'Hoy es mi cumpleaños. De regalo podrias no cantar para el resto del mes :)',

    // --- Cumpleaños de Maite (12 de septiembre de 1971) ---
    '09-12': function (d) {
      var edad = d.getFullYear() - 1971;
      return 'Feliz cumpleaños, Ama. ' + edad + ' años y sigues cantando igual de mal.';
    },

    // --- Concierto de Bihotsak ---
    // (este año cae el mismo día que tu cumpleaños)
    // Este año: cumpleaños + concierto + el solo que le han propuesto.
    // Hoy no toca pulla: hoy toca empujarla a subir sin miedo.
    '2026-09-12':
      'Feliz cumpleaños, Ama. 55 tacos y hoy, encima, concierto de Bihotsak. ' +
      'Y sé lo del solo. Súbete y cántalo sin miedo: si te lo han pedido a ti ' +
      'es porque lo haces bien, por mucho que aquí siempre diga lo contrario. ' +
      'El escenario es tuyo. Un par de huevos y para alante. Te vamos a estar oyendo.',
  };

  /* ---------- Texto para la NOTIFICACIÓN de cada fecha ----------
     A propósito distinto del que se ve dentro de la app (FECHAS): la
     notificación es más corta y directa. Si una clave no está aquí,
     la notificación usa el mismo texto que la app. */
  var AVISOS_FECHA = {
    '01-01': 'Feliz año, Ama. Que este traiga más notas buenas que el anterior.',
    '01-06': 'Feliz día de Reyes. Hoy no se ensaya, es una orden.',
    '12-24': 'Feliz Nochebuena. Villancico listo por si acaso.',
    '12-25': 'Feliz Navidad, Ama. Un abrazo enorme.',
    '12-31': 'Fin de año. Mira todo lo que has cantado estos meses.',

    '08-15': 'Txupinazo en Llodio. Hoy la fiesta, mañana el coro.',
    '10-31': 'Halloween. Sal a asustar, que práctica tienes.',

    '2026-08-29': 'Sábado de morcillas en Llodio. A comer, que hoy no toca cantar.',
    '2027-08-28': 'Sábado de morcillas en Llodio. A comer, que hoy no toca cantar.',
    '2028-08-26': 'Sábado de morcillas en Llodio. A comer, que hoy no toca cantar.',
    '2029-08-25': 'Sábado de morcillas en Llodio. A comer, que hoy no toca cantar.',
    '2030-08-31': 'Sábado de morcillas en Llodio. A comer, que hoy no toca cantar.',

    '2026-05-03': 'Feliz día de la madre, Amatxu. Te queremos mucho.',
    '2027-05-02': 'Feliz día de la madre, Amatxu. Te queremos mucho.',
    '2028-05-07': 'Feliz día de la madre, Amatxu. Te queremos mucho.',
    '2029-05-06': 'Feliz día de la madre, Amatxu. Te queremos mucho.',
    '2030-05-05': 'Feliz día de la madre, Amatxu. Te queremos mucho.',

    '04-09': 'Hoy era el cumpleaños de amama. Un pensamiento para ella.',
    '12-02': 'Cumple de aita. Cántale algo esta noche.',
    '10-27': 'Es mi cumpleaños. Como regalo, un descanso de escalas :)',

    '09-12': function (d) {
      return 'Feliz cumpleaños, Ama. ' + (d.getFullYear() - 1971) + ' tacos. Que sea genial.';
    },
    '2026-09-12': 'Feliz cumpleaños, Ama. Hoy concierto y hoy tu solo. Súbete sin miedo: te lo han pedido porque lo haces bien. A por todas.',
  };

  /* ---------- Días de concierto ----------
     Cuando Maite marca un concierto en el calendario de Práctica
     (conciertos.js), ese día la frase de Inicio y la notificación de
     ánimo salen de aquí. Mismo tono chulesco de siempre: le decimos
     que canta fatal, pero hoy toca salir a darlo todo igualmente. */
  var CONCIERTOS = [
    'Hoy hay concierto. El coro lleva meses tapándote; no lo estropees justo hoy.',
    'Concierto esta tarde. Abre la boca, mueve los labios y deja que canten los de al lado.',
    'Hoy actuáis. Si dudas de una nota, sonríe al público: distrae más que afinar.',
    'Día de concierto. Ponte guapa, que es lo único que llevas clavado del repertorio.',
    'Hoy os escuchan de verdad. Tú disimula y sigue a la de la derecha, que esa sí sabe.',
    'Concierto. Respira, sal ahí y canta como si nadie te oyera. Ojalá.',
    'Hoy cantáis en público. El resto del coro ha ensayado por ti, devuélveles el favor no gritando.',
    'Día grande: concierto. Da igual lo mal que suene, con el vestido puesto parece que sabes.',
    'Hoy toca escenario. Boca pequeña, volumen bajito y a por todas, campeona.',
    'Concierto esta noche. Piensa que entre 30 voces la tuya se pierde. Es tu mayor virtud.',
    'Hoy salís a cantar. Tú marca bien la letra con la cara, que las notas ya las pone el grupo.',
    'Día de concierto. Nadie espera un milagro, solo que acabes la canción en el mismo idioma.',
    'Hoy actúa Bihotsak. Sal, disfruta y, por lo que más quieras, no busques el agudo tú sola.',
    'Concierto. Después de lo de los ensayos, esto solo puede ir a mejor. Un poquito.',
    'Hoy hay función. Ochenta ojos mirándote y tú tan tranquila: no saben lo que les espera.',
    'Hoy concierto. El truco: mira a la directora, no al público, y mueve la boca a tiempo.',
    'Día de actuación. Que no cunda el pánico: el desastre lo repartís entre todas.',
    'Hoy os subís al escenario. Tú ponte en la fila de atrás y proyecta hacia dentro.',
    'Concierto esta tarde. Sonríe mucho al saludar: es la parte que mejor te sale.',
    'Hoy cantáis de verdad. Respira, entra a tiempo y suelta el agudo antes de que te delate.',
    'Día de concierto. El público ha pagado por el coro entero, no por tu solo. Menos mal.',
    'Hoy actúa Bihotsak. Si te pierdes, boca cerrada y cara de estar concentradísima.',
    'Concierto. Ensayaste poco, pero el vestido está planchado. Prioridades claras.',
    'Hoy hay función. Tú piensa en la cena de después y deja que las notas salgan solas.',
    'Día grande. Sal, disfruta y recuerda: en grupo hasta tú suenas bien.',
    'Concierto esta noche. Afina con la de al lado; si ella baja, bajas; si sube, tú calla.',
    'Hoy os escuchan familias enteras. Sé generosa: baja el volumen y reparte el protagonismo.',
    'Día de concierto. Cuarenta años esperando este momento y aún no te sabes el segundo verso.',
    'Hoy actuáis. Entra fuerte en la primera, que es la única que tienes medio pillada.',
    'Concierto. Que se note que disfrutas, aunque por dentro vayas contando compases perdida.',
    'Hoy toca escenario, Ama. Cabeza alta, hombros atrás y fe ciega en el resto del coro.',
    'Día de función. Lo has dado todo en los ensayos: nada. Así que hoy solo puede subir.',
  ];

  var AVISOS_CONCIERTO = [
    'Hoy concierto con Bihotsak. Sal ahí y que canten fuerte los de al lado.',
    'Día de concierto. Boca pequeña, sonrisa grande, y a por todas.',
    'Hoy cantáis en público. Sigue a la del lado y no falla. Suerte, fenómena.',
    'Concierto hoy. Respira hondo y disimula: te sale de maravilla.',
    'Hoy actúa el coro. Da igual cómo suene, tú acaba la canción y ya está.',
    'Concierto esta tarde. El coro te cubre. Solo no chilles el agudo. Mucha mierda.',
    'Hoy toca escenario, Ama. Ponte guapa y deja que el grupo haga el resto.',
    'Hoy concierto. Mira a la directora, entra a tiempo y sonríe mucho. Vas a estar bien.',
    'Día de función. Cabeza alta y fe en el coro. Rómpete una pierna, no las cuerdas.',
    'Concierto en unas horas. Calienta la voz, bebe agua y no busques el agudo tú sola.',
    'Hoy cantáis de verdad. Tú disfruta, que para sufrir ya estuvieron los ensayos.',
    'Concierto hoy. En grupo suenas de maravilla. Aprovéchate de eso sin remordimientos.',
    'Día grande, Ama. Sal, canta bajito y deja que el público piense que sabes. Suerte.',
    'Hoy actúa Bihotsak. Primera canción a tope, el resto tú déjate llevar. A por todas.',
    'Concierto esta tarde. Vestido planchado, sonrisa lista y voz... bueno, ya veremos. Ánimo.',
    'Hoy os subís al escenario. Respira, cuenta hasta cuatro y entra. Lo vas a bordar (más o menos).',
    'Día de concierto. Que se note que lo pasas bien. Lo demás lo ponen las otras 39.',
  ];

  /* ---------- El día DESPUÉS del concierto (mediodía) ----------
     Notificación cabrona preguntando qué tal fue y empujándola a añadir
     el recuerdo (foto + nota) del concierto en Práctica. */
  var AVISOS_POSTCONCIERTO = [
    '¿Qué tal el concierto, Ama? Seguro que las otras 39 lo taparon bien. Añade una foto del recuerdo antes de que se te olvide.',
    'Concierto de ayer: sobreviviste. El coro también. Métele foto y una nota al recuerdo, que para eso está.',
    'Ayer cantasteis. Bueno, ellas cantaron y tú acompañaste. Ponle una foto al recuerdo del concierto.',
    '¿Cómo fue ayer? Si nadie te miró raro, buena señal. Abre Práctica y guarda una foto y cuatro palabras del concierto.',
    'Ya pasó el concierto. Ahora la parte fácil: añadir la foto del recuerdo. Esa sí te sale bien.',
    'Concierto hecho. Que no se pierda: mete foto y nota del recuerdo en Práctica. El agudo ya lo perdiste tú sola, no perdamos también la foto.',
    '¿Qué tal ayer, Ama? Cuéntaselo al recuerdo del concierto: una foto, una frase, y a otra cosa.',
    'Ayer al escenario, hoy a documentarlo. Abre el concierto en Práctica y añádele la foto antes de que la memoria te falle más que el oído.',
  ];

  function fraseConcierto(fecha) {
    return CONCIERTOS[Math.floor(Math.random() * CONCIERTOS.length)];
  }
  function avisoConcierto() {
    return AVISOS_CONCIERTO[Math.floor(Math.random() * AVISOS_CONCIERTO.length)];
  }
  function avisoPostConcierto() {
    return AVISOS_POSTCONCIERTO[Math.floor(Math.random() * AVISOS_POSTCONCIERTO.length)];
  }

  /* ---------- Días con la notificación pospuesta ----------
     Días en los que Maite no va a tener el móvil con la app por la mañana
     (p. ej. trabajando). Toda notificación nuestra de ese día que caiga
     ANTES de la hora indicada se retrasa hasta esa hora; las de después
     se quedan igual.
       '2026-09-12' -> cumpleaños + concierto + su solo: trabaja por la
                       mañana, así que todos los avisos a las 17:30. */
  var POSPONER = {
    '2026-09-12': { h: 17, m: 30 }
  };

  function ymdLocal(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // Devuelve la fecha/hora efectiva de un aviso aplicando POSPONER.
  function posponer(at) {
    var r = POSPONER[ymdLocal(at)];
    if (!r) return at;
    if (at.getHours() < r.h || (at.getHours() === r.h && at.getMinutes() < r.m)) {
      return new Date(at.getFullYear(), at.getMonth(), at.getDate(), r.h, r.m, 0, 0);
    }
    return at;
  }

  /* ---------- Utilidades de fecha ---------- */

  function clavesFecha(d) {
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return [d.getFullYear() + '-' + mm + '-' + dd, mm + '-' + dd];
  }

  function elegir(valor, d) {
    if (typeof valor === 'function') {
      try { return valor(d) || null; } catch (e) { return null; }
    }
    if (Array.isArray(valor)) {
      if (!valor.length) return null;
      return valor[Math.abs(d.getFullYear()) % valor.length];
    }
    return valor || null;
  }

  /* ---------- API ---------- */

  // Mensaje concreto si hoy es una fecha marcada; si no, null.
  function especialDeHoy(fecha) {
    var d = fecha || new Date();
    var claves = clavesFecha(d);
    for (var i = 0; i < claves.length; i++) {
      if (FECHAS[claves[i]] != null) {
        return elegir(FECHAS[claves[i]], d);
      }
    }
    return null;
  }

  // Última frase mostrada, para no repetirla dos visitas seguidas.
  var ultima = null;

  function alAzar(lista) {
    if (!lista.length) return '';
    var f = lista[Math.floor(Math.random() * lista.length)];
    if (f === ultima && lista.length > 1) {
      f = lista[Math.floor(Math.random() * lista.length)];
    }
    ultima = f;
    return f;
  }

  // Frase de bienvenida. Las de fecha dependen del calendario; las
  // normales y las de domingo cambian en cada visita a Inicio.
  function delDia(fecha) {
    var d = fecha || new Date();

    // Fechas marcadas (cumpleaños, fiestas) mandan sobre todo: la de
    // Maite el 12/09 ya menciona el concierto en su propio texto.
    var esp = especialDeHoy(d);
    if (esp) return { texto: esp, especial: true };

    // Día de concierto: frase propia con retranca.
    if (window.Conciertos && window.Conciertos.hoy) {
      try {
        if (window.Conciertos.hoy(d)) {
          return { texto: fraseConcierto(d), especial: true, concierto: true };
        }
      } catch (e) {}
    }

    var claveMD = clavesFecha(d)[1];
    if (ESTACIONES[claveMD]) return { texto: ESTACIONES[claveMD], especial: false };

    if (d.getDate() === 1 && MESES[d.getMonth()]) {
      return { texto: MESES[d.getMonth()], especial: false };
    }

    if (d.getDay() === 0) {
      return { texto: alAzar(DOMINGOS), especial: false };
    }

    return { texto: alAzar(GENERALES), especial: false };
  }

  /* ---------- Celebraciones (opción 4) ---------- */

  var ENHORABUENA = [
    'Aprendida. Una menos y los vecinos lo notan.',
    'Esa ya te la sabes. Ahora no la sueltes en cada comida.',
    'Una más para el repertorio. Y van.',
    'Lista. Esta ha costado, reconócelo.',
    'Cerrada. Ahora a mantenerla, que se olvidan solas.',
    'Aprendida. Después de oírla mil veces, algo se nos ha pegado a todos.',
    'Ya es tuya. Lúcela en el ensayo, no en el ascensor.',
    'Aprendida. Milagros los justos, pero este ha llegado.',
    'Hecho. Ha caído más tarde que pronto, pero ha caído.',
    'Una canción más domada. La afinación, otro día.',
    'Aprendida. Brindemos, y que no te oiga nadie brindando.',
    'Lista. La cantaste entera y en su tono. Casi lloramos.',
    'Cerrada esa. Ahora te la sabes hasta para molestar en el coche.',
    'Aprendida. El coro respira; tú, a por la siguiente.',
    'Esa ya está. Poco a poco vas juntando un repertorio y todo.',
    'Terminada. Y solo has tardado lo que dura una legislatura.',
    'Aprendida. Guárdala bien, que reaprenderla es otro suplicio para todos.',
    'Una más. A este ritmo, para 2030 tienes un concierto entero.',
    'Lista. Te ha quedado decente. Decente para ti es un notable.',
    'Aprendida. Los platos del armario descansan una temporada.',
    'Hecho. Esta se te resistía y le has ganado la partida.',
    'Cerrada. Ahora tócala poco, no vaya a estropearse.',
    'Aprendida. Ha sonado a canción y todo, qué momento.',
    'Una menos en la lista de pendientes, una más en la de reincidencias.',
    'Aprendida. El perro ha vuelto al salón. Buena señal.',
    'Terminada. Nos ha costado a todos, pero sobre todo a nuestros oídos.',
    'Aprendida. Ya puedes fardar en el ensayo del martes.',
    'Esa cae. Y ha caído sin gallos en el estribillo, ojo.',
    'Aprendida. Constancia 1 - Canción 0.',
    'Hecho. La próxima seguro que también, aunque nos cueste creerlo.'
  ];

  function enhorabuena() {
    return ENHORABUENA[Math.floor(Math.random() * ENHORABUENA.length)];
  }

  // Frase para una racha redonda de días de estudio. Devuelve null
  // si `dias` no es un hito.
  var HITOS = {
    3: '3 días seguidos. Ya es costumbre, y en casa se nota.',
    7: 'Una semana sin fallar un día. Ni tú te lo crees.',
    14: '14 días seguidos. La familia pide un descanso, tú sigue.',
    21: 'Tres semanas seguidas. Eso es más constancia que cualquiera de nosotros.',
    30: 'Un mes entero cantando cada día. Oficialmente imparable.',
    50: '50 días seguidos. Deberían darte algo.',
    100: '100 días. Ahí queda eso. Y lo que te queda.'
  };

  function hito(dias) {
    return HITOS[dias] || null;
  }

  /* ---------- Aviso de racha (notificación de las ~20:00) ----------
     Si Maite tiene una racha viva y aún no ha estudiado, avisos.js
     programa una notificación por la tarde para que no la pierda.
     Mismo tono cabrón de siempre: canta regular, pero que no falle.
     El símbolo § se sustituye por "N días" (o "1 día"). */
  var RACHA_URGENTE = [
    'Son las ocho y no has cantado. Tu racha de § se muere esta noche. Espabila.',
    'Llevas § seguidos desafinando con constancia y hoy lo tiras por vaga. Abre ChorApp.',
    'Maite, tu racha de § pende de un hilo. Cinco minutos de sufrimiento para los oídos de casa y salvada.',
    'Última llamada: canta algo hoy o mañana empiezas la racha desde cero, como una novata.',
    'Tu racha de § te mira con cara de pena. Ponte, aunque sea a media voz y de espaldas.',
    'Hoy no has tocado la app. § de constancia a punto de irse a la basura. Menudo desperdicio.',
    'Las 20:00. Toca que la casa entera sufra un ratito. Por la racha: § en juego.',
    'Como no cantes hoy, esos § no valen para nada. Y ya sabes lo que cuesta que suenes decente.',
    'Racha de § en peligro. Vamos, una cancioncita mala y a la cama con la conciencia tranquila.',
    'No dejes que § de esfuerzo los tumbe una noche de pereza. Aunque sea el estribillo. Va.'
  ];
  var RACHA_MANTENER = [
    'Mañana, otra vez. La racha de § no se mantiene sola, y tu oído tampoco mejora solo.',
    'Recordatorio: mañana a cantar. Aunque sea flojito, pero todos los días. Esa es la gracia.',
    'Vas por §. No te vengas arriba, que en cuanto fallas uno vuelves a sonar a principiante.',
    'La racha sigue viva. Mañana a la misma hora, la misma tortura para el vecindario. Ahí estaré.',
    '§ seguidos. Sorprendente, la verdad. Mantenlo, que la cosa promete… poco, pero promete.',
    'Mañana toca. La racha de § es lo único que te sale redondo ahora mismo, no la sueltes.',
    'Sigue así: canta un poco cada día y algún año de estos te sale una nota limpia.',
    'Recordatorio cariñoso: mañana, ChorApp. La constancia se te da mejor que el agudo.'
  ];

  function _diasTxt(n) {
    n = Math.max(1, n | 0);
    return n === 1 ? '1 día' : n + ' días';
  }
  function avisoRacha(dias, urgente) {
    var pool = urgente ? RACHA_URGENTE : RACHA_MANTENER;
    var t = pool[Math.floor(Math.random() * pool.length)];
    return t.replace('§', _diasTxt(dias));
  }

  /* Notificación del resumen mensual (día 1). § = nombre del mes que
     acaba de terminar. Tono cabrón, pero con ganas de que lo abra. */
  var AVISO_MES = [
    'Ya está el resumen de §. Ábrelo, que hay lectura y alguna pulla.',
    'Se acabó §. Entra a ver el balance: días, canciones y lo que te queda.',
    'Resumen de § listo. A ver si cantaste tanto como dices.',
    'Nuevo mes, cuentas claras. El resumen de § te espera en la app.',
    '§ ha terminado. Ábrelo y mira el resumen, que este mes toca superarse.',
    'El resumen de § ya está. Spoiler: constante sí, afinada… hablamos.'
  ];
  function avisoMes(nombreMes) {
    var t = AVISO_MES[Math.floor(Math.random() * AVISO_MES.length)];
    t = t.replace('§', String(nombreMes || 'el mes'));
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* Notificación del Wrapped ANUAL (31 de diciembre por la tarde). § = año.
     Tono cálido: es el regalo dentro del regalo, no toca meter pulla. */
  var AVISO_ANUAL = [
    'Se acaba §. Tu año entero en ChorApp ya está listo — este merece sofá y sin prisa.',
    '§ de música, mes a mes. Abre la app cuando tengas un rato tranquilo: hoy toca celebrarte.',
    'Tu año en Bihotsak, en una tanda de pantallas. Ábrelo, Ama, que vas a sonreír.',
    'Último día de §. El resumen de todo el año te espera en ChorApp. Feliz año.'
  ];
  function avisoAnual(anio) {
    var t = AVISO_ANUAL[Math.floor(Math.random() * AVISO_ANUAL.length)];
    t = t.replace('§', String(anio || 'el año'));
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ---------- Hora de la notificación según el tipo de fecha ----------
       Su cumpleaños ......... 9:00
       Fiestas .............. 11:00
       Conciertos .......... 13:00   (los pone conciertos.js)
       Otros cumpleaños .... 16:00
     Así cada aviso llega a una hora que le pega. */
  var HORA_AVISO = { cumpleMaite: 9, fiesta: 11, concierto: 13, otroCumple: 16 };
  var CUMPLE_MAITE = { '09-12': true };
  var OTROS_CUMPLES = { '04-09': true, '12-02': true, '10-27': true };

  // Categoría de una fecha marcada (por su MM-DD). Todo lo que no sea un
  // cumpleaños concreto se considera "fiesta".
  function categoriaFecha(d) {
    var md = clavesFecha(d)[1];
    if (CUMPLE_MAITE[md]) return 'cumpleMaite';
    if (OTROS_CUMPLES[md]) return 'otroCumple';
    return 'fiesta';
  }

  /* ---------- Fechas señaladas próximas (para notificaciones) ----------
     Recorre los próximos `dias` días y devuelve las fechas de FECHAS que
     caen dentro, con su texto ya resuelto y la hora que le toca a su tipo.
     Cada una lleva un `id` numérico estable (AAAAMMDD) para poder
     programar/cancelar la notificación sin duplicarla. */
  // Texto de la notificación para una fecha (AVISOS_FECHA; si no hay,
  // el mismo que muestra la app).
  function avisoTextoDe(d) {
    var claves = clavesFecha(d);
    for (var i = 0; i < claves.length; i++) {
      if (AVISOS_FECHA[claves[i]] != null) return elegir(AVISOS_FECHA[claves[i]], d);
    }
    return especialDeHoy(d);
  }

  function proximasFechas(dias, desde) {
    dias = dias || 400;
    var hoy = desde ? new Date(desde) : new Date();
    hoy.setHours(0, 0, 0, 0);
    var salida = [];
    for (var i = 0; i <= dias; i++) {
      var d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + i);
      if (!especialDeHoy(d)) continue;
      var h = HORA_AVISO[categoriaFecha(d)] || 11;
      var at = posponer(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0));
      if (at.getTime() <= Date.now()) continue; // antes de esa hora aún vale; ya pasada: fuera
      salida.push({
        id: d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(),
        fecha: at,
        texto: avisoTextoDe(d)
      });
    }

    // Días de concierto marcados en Práctica (conciertos.js): notificación
    // de ánimo a las 13:00. Van con id propio, así que no chocan con lo de arriba.
    if (window.Conciertos && window.Conciertos.proximos) {
      try {
        window.Conciertos.proximos(dias, hoy).forEach(function (c) {
          if (c.fecha) c.fecha = posponer(c.fecha);
          if (c.fecha && c.fecha.getTime() > Date.now()) salida.push(c);
        });
      } catch (e) {}
    }

    return salida;
  }

  return {
    delDia: delDia,
    especialDeHoy: especialDeHoy,
    enhorabuena: enhorabuena,
    hito: hito,
    avisoRacha: avisoRacha,
    avisoMes: avisoMes,
    avisoAnual: avisoAnual,
    fraseConcierto: fraseConcierto,
    avisoConcierto: avisoConcierto,
    avisoPostConcierto: avisoPostConcierto,
    proximasFechas: proximasFechas
  };
})();
