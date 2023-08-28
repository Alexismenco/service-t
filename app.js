const express = require('express');
var session = require('express-session');
const app = express();
const servicios = require('./public/js/servicioAseo');
require('dotenv').config();
const nodemailer=require('nodemailer');

const WebpayPlus = require('transbank-sdk').WebpayPlus;
const { Options, IntegrationApiKeys, Environment, IntegrationCommerceCodes } = require("transbank-sdk");

app.use(session({
  secret: process.env.FRASESECRETA,
  resave: false,
  saveUninitialized: true
}));

// configuracion correo
var transporter=nodemailer.createTransport({
  service:'gmail',
  auth:{
    user:process.env.MAILUSER,
    pass:process.env.MAILPASS
  }
});

// configuracion server
app.use(express.urlencoded({extended:false}));
app.use(express.static('public'));
app.set('view engine',"ejs");
app.set("views",__dirname+"/views");

// Inicio
app.get('/', async (req,res) => {
  res.render('index');
});

// Planes -> pagar/plan
app.get('/planes', async (req, res) => {
  res.render('planes');
});

// Agendar Formulario
app.post('/agendar', async (req, res) => {
  // Servicio y horario escogido por el usuario
  var tamano = req.body.tamano;
  var area = req.body.tipo;
  var servicioImg;
  var servicioPrecio;

  for (let i = 0; i < servicios.aseo.length; i++) {
    // Valido si es igual el tamaño y el area
    if (req.body.tamano == servicios.aseo[i].area) {
      const tipo = req.body.tipo.toLowerCase();
      const servicio = servicios.aseo[i].servicios[tipo];
  
      if (servicio) {
        servicioImg = servicio.img;
        servicioPrecio = servicio.precio;
      } else {
        console.log('No se encontró el tipo de servicio correspondiente.');
      }
      break; // Termina el ciclo una vez encontrado el área coincidente
    }
  }

  res.render('agendar',{ servicioImg, servicioPrecio, tamano, area });
});

// Pagar por webpay o td
app.post('/pagar', async (req, res) => {
  req.session.agendar = req.body;

    // Configuracion webpay
    IntegrationCommerceCodes.WEBPAY_PLUS = process.env.TBKAPIKEYID;
    IntegrationApiKeys.WEBPAY = process.env.TBKAPIKEYSECRET;
  
    let buyOrder = "O-" + Math.floor(Math.random() * 10000) + 1;
    let sessionId = "S-" + Math.floor(Math.random() * 10000) + 1;
    req.session.agendar.orden = buyOrder;
    req.session.agendar.session = sessionId;
  
    const tx = new WebpayPlus.Transaction(new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration));
    const response = await tx.create(buyOrder, sessionId, parseInt(req.body.precio), process.env.DIRECCIONRETORNO);
    
    const token = response.token;
    const url = response.url;

  res.render('pagar',{ token, url, buyOrder });
});

// Vuelta del pago de webpay o td
app.get('/pago', async (req, res) => {
  var data = req.session.agendar;

  let params = req.method === 'GET' ? req.query : req.body;
  let token = req.query.token_ws;
  let tbkToken = params.TBK_TOKEN;
  let step;
  let compra=false;

  if (token && !tbkToken) {//Flujo 1
    const tx = new WebpayPlus.Transaction(new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration));
    const commitResponse = await tx.commit(token);
    if(commitResponse.status=='AUTHORIZED'){
      step = "Transacción exitosa.";
      compra = true;

      var email = `
            <html>
            <body style="font-family: Arial, sans-serif;">
                <h2>Nuevo Servicio Adquirido</h2>
                <p>Se ha realizado una nueva compra en el sitio.</p>
                <p>Detalles de la compra:</p>
                <ul>
                    <li>Servicio: Limpieza ${data.tipo} para ${data.tamano} metros cuadrados</li>
                    <li>Monto: $${data.precio}</li>
                </ul>
                <p>Detalles del usuario:</p>
                <ul>
                    <li>Nombre completo: ${data.nombre} ${data.apellidos}</li>
                    <li>Dirección: ${data.street}</li>
                    <li>N° Celular: ${data.phone}</li>
                    <li>N° Orden: ${data.orden}</li>
                    <li>N° Sesión: ${data.session}</li>
                    <li>Notas: ${data.order}</li>
                </ul>
            </body>
            </html>
        `;

        // Email cliente
      const mail = {
        from: process.env.MAILUSER, // De la empresa
        to: `${data.email}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      }

      // Email Encargado
      const mail2 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${process.env.MAILENCARGADO}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail2, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      

    }else if (!token && !tbkToken) {//Flujo 2
      step = "El pago fue anulado por tiempo de espera.";
    }else if (!token && tbkToken) {//Flujo 3
      step = "El pago fue anulado por el usuario.";
    }else{//Flujo 4
      step = "El pago es inválido.";
    }

    res.render('pago', {step, compra});
});

app.post('/td', async (req, res) => {
  var data = req.session.agendar;

  const email = `
            <html>
            <body style="font-family: Arial, sans-serif;">
                <h2>Nuevo Servicio Adquirido</h2>
                <p>Se ha realizado una nueva compra en el sitio.</p>
                <p>Recuerda que no se procesará hasta que se haya recibido el importe en nuestra cuenta.</p>
                <p>Detalles de la compra:</p>
                <ul>
                    <li>Servicio: Limpieza ${data.tipo} para ${data.tamano} metros cuadrados</li>
                    <li>Monto: $${data.precio}</li>
                </ul>
                <p>Detalles del usuario:</p>
                <ul>
                    <li>Nombre completo: ${data.nombre} ${data.apellidos}</li>
                    <li>Dirección: ${data.street}</li>
                    <li>N° Celular: ${data.phone}</li>
                    <li>N° Orden: ${data.orden}</li>
                    <li>N° Sesión: ${data.session}</li>
                    <li>Notas: ${data.order}</li>
                </ul>
            </body>
            </html>
        `;

        // Email cliente
      var mail3 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${data.email}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail3, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      

      // Email Encargado
      var mail4 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${process.env.MAILENCARGADO}`, // Correo
        subject: '¡Compra por pagar!',
        html: email,
      };
      transporter.sendMail(mail4, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });

    res.render('td');
});


/* PAGO Plan */
// Pagar por webpay o td
app.post('/plan', async (req, res) => {
  req.session.agendar = req.body;


    // Configuracion webpay
    IntegrationCommerceCodes.WEBPAY_PLUS = process.env.TBKAPIKEYID;
    IntegrationApiKeys.WEBPAY = process.env.TBKAPIKEYSECRET;
  
    let buyOrder = "O-" + Math.floor(Math.random() * 10000) + 1;
    let sessionId = "S-" + Math.floor(Math.random() * 10000) + 1;
    req.session.agendar.orden = buyOrder;
    req.session.agendar.session = sessionId;

    const tx = new WebpayPlus.Transaction(new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration));
    const response = await tx.create(buyOrder, sessionId, parseInt(req.body.precio), process.env.DIRECCIONRETORNOPLAN);
    
    const token = response.token;
    const url = response.url;

  res.render('pagarPlan',{ token, url, buyOrder });
});

// Pago plan vuleta de transbank
app.get('/plan/pago', async (req, res) => {
  var data = req.session.agendar;

  let params = req.method === 'GET' ? req.query : req.body;
  let token = req.query.token_ws;
  let tbkToken = params.TBK_TOKEN;
  let step;
  let compra=false;

  if (token && !tbkToken) {//Flujo 1
    const tx = new WebpayPlus.Transaction(new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration));
    const commitResponse = await tx.commit(token);
    if(commitResponse.status=='AUTHORIZED'){
      step = "Transacción exitosa.";
      compra = true;

      var email = `
            <html>
            <body style="font-family: Arial, sans-serif;">
                <h2>Nuevo Servicio Adquirido</h2>
                <p>Se ha realizado una nueva compra en el sitio.</p>
                <p>Detalles de la compra:</p>
                <ul>
                    <li>Servicio: Limpieza plan ${data.plan}</li>
                    <li>Monto: $${data.precio}</li>
                </ul>
                <p>Detalles del usuario:</p>
                <ul>
                    <li>Nombre completo: ${data.nombre} ${data.apellidos}</li>
                    <li>Dirección: ${data.street}</li>
                    <li>N° Celular: ${data.phone}</li>
                    <li>N° Orden: ${data.orden}</li>
                    <li>N° Sesión: ${data.session}</li>
                    <li>Notas: ${data.order}</li>
                </ul>
            </body>
            </html>
        `;

        // Email cliente
      const mail = {
        from: process.env.MAILUSER, // De la empresa
        to: `${data.email}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      }

      // Email Encargado
      const mail2 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${process.env.MAILENCARGADO}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail2, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      

    }else if (!token && !tbkToken) {//Flujo 2
      step = "El pago fue anulado por tiempo de espera.";
    }else if (!token && tbkToken) {//Flujo 3
      step = "El pago fue anulado por el usuario.";
    }else{//Flujo 4
      step = "El pago es inválido.";
    }

    res.render('pago', {step, compra});
});

// Plan td
app.post('/plan/td', async (req, res) => {
  var data = req.session.agendar;

  const email = `
            <html>
            <body style="font-family: Arial, sans-serif;">
                <h2>Nuevo Servicio Adquirido</h2>
                <p>Se ha realizado una nueva compra en el sitio.</p>
                <p>Recuerda que no se procesará hasta que se haya recibido el importe en nuestra cuenta.</p>
                <p>Detalles de la compra:</p>
                <ul>
                    <li>Servicio: Limpieza plan ${data.plan}</li>
                    <li>Monto: $${data.precio}</li>
                </ul>
                <p>Detalles del usuario:</p>
                <ul>
                    <li>Nombre completo: ${data.nombre} ${data.apellidos}</li>
                    <li>Dirección: ${data.street}</li>
                    <li>N° Celular: ${data.phone}</li>
                    <li>N° Orden: ${data.orden}</li>
                    <li>N° Sesión: ${data.session}</li>
                    <li>Notas: ${data.order}</li>
                </ul>
            </body>
            </html>
        `;

        // Email cliente
      var mail3 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${data.email}`, // Correo
        subject: '¡Compra Exitosa!',
        html: email,
      };
      transporter.sendMail(mail3, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });
      

      // Email Encargado
      var mail4 = {
        from: process.env.MAILUSER, // De la empresa
        to: `${process.env.MAILENCARGADO}`, // Correo
        subject: '¡Compra por pagar PLAN!',
        html: email,
      };
      transporter.sendMail(mail4, (err, info) => {
        if (err) {
          console.log("Error en el correo: " + err.message);
          res.status(500).send("Error al enviar correo");
        } else {
          console.log("Correo enviado: " + info.response);
        }
      });

    res.render('td');
});

app.get('/nosotros', async (req, res) => {
  res.render('nosotros');
});
module.exports={app}