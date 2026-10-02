import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, Observable } from 'rxjs';
import { BusinessError } from '../errors/business-errors';

@Injectable()
export class BusinessErrorsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        if (error.type === BusinessError.NOT_FOUND)
          throw new HttpException(error.message, HttpStatus.NOT_FOUND);
        else if (error.type === BusinessError.PRECONDITION_FAILED)
          throw new HttpException(
            error.message,
            HttpStatus.PRECONDITION_FAILED,
          );
        else if (error.type === BusinessError.BAD_REQUEST)
          throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
        else if (error.type === BusinessError.BAD_GATEWAY)
          throw new HttpException(error.message, HttpStatus.BAD_GATEWAY);
        else if (error.type === BusinessError.GATEWAY_TIMEOUT)
          throw new HttpException(error.message, HttpStatus.GATEWAY_TIMEOUT);
        else if (error.type === BusinessError.UNAUTHORIZED)
          throw new HttpException(error.message, HttpStatus.UNAUTHORIZED);
        else if (error.type === BusinessError.FORBIDDEN)
          throw new HttpException(error.message, HttpStatus.FORBIDDEN);
        else throw error;
      }),
    );
  }
}
