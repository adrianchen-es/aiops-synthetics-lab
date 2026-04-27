FROM httpd:2.4-alpine
# Default image keeps SSL as a loadable module
RUN sed -i 's@#LoadModule ssl_module@LoadModule ssl_module@' /usr/local/apache2/conf/httpd.conf
COPY apache/httpd-ssl.conf /usr/local/apache2/conf.d/000-ssl.conf
